// Practice Loop (the owner, 2026-11-17): an endless ear-training and time player for the owner only (the page shows its
// entry only when /api/me says moderator: Garage → Settings → Practice Loop, web/practice_loop.js). It must keep playing
// for hours with the screen locked, so all of it runs here, not in the web view (which iOS suspends in the background):
//
//   - The sound is made sample by sample by ApexKit's PracticeRenderer inside an AVAudioSourceNode on AVAudioEngine.
//     Clicks and notes are placed by counting samples on the audio thread, so nothing waits on a timer.
//   - Each block's callout ("D Dorian, 92 BPM") is pre-rendered with AVSpeechSynthesizer.write into samples while the block
//     before it plays, and mixed in by the renderer. Speech spoken live with the screen locked is the part iOS is known to
//     drop; pre-rendered, the callout is just more samples. Only if rendering fails is it spoken live instead.
//   - The session is .playback with no mixing (UIBackgroundModes audio is already on for the co-driver), so it owns the
//     lock screen's Now Playing card and its play / pause / next keys (MPRemoteCommandCenter).
//   - A call or Siri pauses it; it resumes when iOS says it should. Headphones unplugged pause it (Apple's rule for players).
//
// Nothing here exists until the page first asks for it, and stop() tears the engine, timer and remote keys down again,
// so the app costs nothing more when it isn't playing. The co-driver and convoy voice share the one session: while this
// plays, the shell (ApexSensorShell.releaseVoice) hands the session back to it instead of turning it off, and convoy
// voice (which needs the microphone) stops it.
//
// The voice range (Nate 2026-11-17): "sing as high as possible and low as possible and it will only include tones in that
// range for that session". The sheet's Test my range listens to the microphone (asked for only then) for the lowest held
// note, then the highest (ApexKit PracticeRangeTracker), and from then until the app quits every block's root sits where
// root to octave fits inside it (PracticePicker.next(range:)). It is never saved and nothing is recorded: the samples are
// read for their pitch and dropped. The player pauses while it listens and carries on after.
import AVFoundation
import Foundation
import MediaPlayer
import UIKit
import ApexKit

@MainActor
final class ApexPracticeLoop {
    private static let defaultsKey = "apex.practice.v1"
    private weak var shell: ApexSensorShell?
    private(set) var settings: PracticeSettings

    private var engine: AVAudioEngine?
    private var renderer: PracticeRenderer?
    private var rng = SystemRandomNumberGenerator()
    private var lastPick: PracticePick?
    private var picks: [Int: PracticePick] = [:]
    private var liveCallout: Set<Int> = []        // blocks whose callout could not be rendered: spoken live as they start
    private var nextId = 0
    private var making = false
    private var poll: Timer?
    private var active = false                    // the player is up (playing or paused)
    private var playing = false
    private var resumeAfterInterruption = false
    private var shownId = -1
    private var startedAt = Date()
    private var observers: [NSObjectProtocol] = []
    private var targets: [(MPRemoteCommand, Any)] = []
    private lazy var writer = AVSpeechSynthesizer()   // renders callouts into samples (never plays)
    private lazy var live = AVSpeechSynthesizer()     // the fallback, if a callout couldn't be rendered
    private var writeGen = 0
    // The page's pictures (web/practice_viz.js): only while the Practice Loop sheet is on screen and the app is in front,
    // the poll sends where the block is (`sendClock`). Locked or in the background, nothing is sent.
    private var watching = false
    // the voice range: kept for this run of the app only
    private var range: ClosedRange<Int>?
    private var rangeStep: String?                // "low" | "high" while the test listens
    private var rangeLow: Int?
    private var rangeError: String?
    private var heard: (now: Int?, low: Int?, high: Int?) = (nil, nil, nil)
    private var listener: AVAudioEngine?
    private var listenGen = 0
    private var resumeAfterRange = false

    init(shell: ApexSensorShell) {
        self.shell = shell
        var s = PracticeSettings()
        if let d = UserDefaults.standard.data(forKey: Self.defaultsKey), let saved = try? JSONDecoder().decode(PracticeSettings.self, from: d) { s = saved }
        settings = s.clamped
    }

    /// The page's message: {cmd: 'practice', action: 'state'|'start'|'pause'|'toggle'|'next'|'stop'|'settings', settings?}.
    func handle(_ dict: [String: Any]) {
        if let s = dict["settings"] as? [String: Any] { apply(s) }
        switch (dict["action"] as? String) ?? "state" {
        case "start": play()
        case "pause": pause()
        case "toggle": playing ? pause() : play()
        case "next": next()
        case "stop": stop()
        case "watch": watching = (dict["on"] as? Bool) ?? false; sendClock()
        case "range": rangeAction((dict["step"] as? String) ?? "")
        default: break
        }
        report()
    }

    var isActive: Bool { active }
    var isListening: Bool { listener != nil }

    // MARK: settings

    private func apply(_ incoming: [String: Any]) {
        guard let cur = try? JSONSerialization.jsonObject(with: JSONEncoder().encode(settings)) as? [String: Any] else { return }
        var merged = cur
        for (k, v) in incoming { merged[k] = v is NSNull ? nil : v }
        guard let data = try? JSONSerialization.data(withJSONObject: merged),
              let s = try? JSONDecoder().decode(PracticeSettings.self, from: data) else { return }
        let old = settings
        settings = s.clamped
        if let d = try? JSONEncoder().encode(settings) { UserDefaults.standard.set(d, forKey: Self.defaultsKey) }
        guard let r = renderer else { return }
        r.volume = Float(settings.volume)
        r.droneOn = settings.drone
        if old.sleepMin != settings.sleepMin { r.stop(after: settings.sleepMin > 0 ? Double(settings.sleepMin) * 60 : nil); startedAt = Date() }
        // what the next block may be changed: the one already queued is made again
        var a = old, b = settings
        a.volume = 0; b.volume = 0; a.drone = true; b.drone = true; a.sleepMin = 0; b.sleepMin = 0
        if a != b { r.clearPending(); writeGen += 1; making = false; makeBlock() }
    }

    // MARK: play / pause / stop

    func play() {
        if active {
            if !playing { resume() }
            return
        }
        active = true
        shell?.setPractice(true)
        observe()
        commands()
        ApexAudioSession.queue.async {
            let s = AVAudioSession.sharedInstance()
            try? s.setCategory(.playback, mode: .default, options: [])
            try? s.setActive(true)
            let rate = s.sampleRate
            Task { @MainActor [weak self] in self?.startEngine(rate: rate) }
        }
    }

    private func startEngine(rate: Double) {
        guard active else { return }
        let r = renderer ?? PracticeRenderer(sampleRate: rate > 0 ? rate : 48000)
        if renderer == nil {
            r.volume = Float(settings.volume)
            r.droneOn = settings.drone
            r.stop(after: settings.sleepMin > 0 ? Double(settings.sleepMin) * 60 : nil)
            renderer = r
            startedAt = Date()
        }
        let e = AVAudioEngine()
        let fmt = AVAudioFormat(standardFormatWithSampleRate: r.sampleRate, channels: 1)!
        let node = Self.sourceNode(r, format: fmt)
        e.attach(node)
        e.connect(node, to: e.mainMixerNode, format: fmt)
        e.prepare()
        do { try e.start() } catch {
            shell?.sendToPage(["type": "practice", "error": "Couldn't start the audio: \(error.localizedDescription)"])
            stop()
            return
        }
        engine = e
        playing = true
        makeBlock()
        startPoll()
        nowPlaying()
        report()
    }

    /// The audio thread's side: nonisolated, so the render block never touches the main actor.
    nonisolated private static func sourceNode(_ r: PracticeRenderer, format: AVAudioFormat) -> AVAudioSourceNode {
        AVAudioSourceNode(format: format) { _, _, frameCount, abl -> OSStatus in
            let list = UnsafeMutableAudioBufferListPointer(abl)
            guard let first = list.first, let p = first.mData?.assumingMemoryBound(to: Float.self) else { return noErr }
            let n = Int(frameCount)
            r.render(p, count: n)
            for b in list.dropFirst() { if let d = b.mData { memcpy(d, p, n * MemoryLayout<Float>.size) } }
            return noErr
        }
    }

    func pause() {
        guard active, playing else { return }
        engine?.pause()
        playing = false
        poll?.invalidate(); poll = nil
        nowPlaying()
        report()
    }

    private func resume() {
        guard active, !playing, let e = engine else { return }
        ApexAudioSession.queue.async {
            let s = AVAudioSession.sharedInstance()
            try? s.setCategory(.playback, mode: .default, options: [])
            try? s.setActive(true)
            Task { @MainActor [weak self] in
                guard let self, self.active, !self.playing else { return }
                do { try e.start() } catch { return }
                self.playing = true
                self.startPoll()
                self.nowPlaying()
                self.report()
            }
        }
    }

    func next() {
        guard active, let r = renderer else { return }
        r.skip()
        makeBlock()
    }

    func stop() {
        if rangeStep != nil { endListening(error: nil) }
        guard active else { return }
        active = false
        playing = false
        resumeAfterInterruption = false
        engine?.stop()
        engine = nil
        renderer = nil
        poll?.invalidate(); poll = nil
        writeGen += 1
        making = false
        picks = [:]; liveCallout = []; shownId = -1
        if live.isSpeaking { live.stopSpeaking(at: .immediate) }
        for o in observers { NotificationCenter.default.removeObserver(o) }
        observers = []
        for (c, t) in targets { c.removeTarget(t) }
        targets = []
        MPRemoteCommandCenter.shared().nextTrackCommand.isEnabled = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        shell?.setPractice(false)
        report()
    }

    // MARK: blocks

    /// Picks the next block and renders its callout, then queues it. One at a time; the poll asks again when it's taken.
    private func makeBlock() {
        guard active, !making, let r = renderer, r.needsBlock else { return }
        making = true
        let pick = PracticePicker.next(settings, after: lastPick, range: range, using: &rng)
        lastPick = pick
        let id = nextId; nextId += 1
        let gen = writeGen
        render(callout: pick.callout, root: pick.root, rate: r.sampleRate) { [weak self] samples in
            guard let self, self.active, gen == self.writeGen, let r = self.renderer else { return }
            self.making = false
            self.picks[id] = pick
            if samples.isEmpty { self.liveCallout.insert(id) }
            // a live callout needs its lead long enough to be said in: about 2 s of silence stands in for the samples
            r.offer(PracticeBlock(id: id, pick: pick, callout: samples.isEmpty ? [Float](repeating: 0, count: Int(r.sampleRate * 2.2)) : samples))
        }
    }

    /// The callout as mono samples at `rate`, peak-normalised; [] when the synthesizer gave nothing within 4 s.
    private func render(callout text: String, root: Int, rate: Double, done: @escaping @MainActor ([Float]) -> Void) {
        let box = CalloutBox()
        var finished = false
        let finish: @MainActor () -> Void = {
            guard !finished else { return }
            finished = true
            done(box.samples(at: rate))
        }
        writer.write(Self.utterance(text, root: root)) { buffer in
            guard let pcm = buffer as? AVAudioPCMBuffer else { return }
            if pcm.frameLength == 0 { Task { @MainActor in finish() }; return }
            box.add(pcm)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { MainActor.assumeIsolated { finish() } }
    }

    private static func utterance(_ text: String, root: Int) -> AVSpeechUtterance {
        let a = NSMutableAttributedString(string: text)
        // "A Dorian" is read as the article ("uh Dorian"): the note's letter is given its sound
        if PracticeTheory.rootSpoken[root].hasPrefix("A") {
            a.addAttribute(NSAttributedString.Key(AVSpeechSynthesisIPANotationAttribute), value: "ˈeɪ", range: NSRange(location: 0, length: 1))
        }
        let u = AVSpeechUtterance(attributedString: a)
        u.voice = voice
        u.rate = 0.5
        return u
    }

    private static let voice: AVSpeechSynthesisVoice? = {
        let en = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("en") }
        func rank(_ v: AVSpeechSynthesisVoice) -> Int {
            (v.quality == .premium ? 4 : v.quality == .enhanced ? 2 : 0) + (v.language == "en-US" ? 1 : 0)
        }
        return en.max { rank($0) < rank($1) } ?? AVSpeechSynthesisVoice(language: "en-US")
    }()

    // MARK: the poll (main thread, only while playing): refills the queue, follows the block on air, the sleep timer

    private func startPoll() {
        poll?.invalidate()
        let t = Timer(timeInterval: 0.25, repeats: true) { _ in MainActor.assumeIsolated { [weak self] in self?.tick() } }
        t.tolerance = 0.05
        RunLoop.main.add(t, forMode: .common)
        poll = t
    }

    private func tick() {
        guard active, let r = renderer else { return }
        r.collect()
        let st = r.status
        if st.finished { stop(); return }
        if st.blockId != shownId, st.blockId >= 0 {
            shownId = st.blockId
            for k in picks.keys where k < shownId { picks.removeValue(forKey: k) }
            if liveCallout.remove(shownId) != nil, let p = picks[shownId] {
                if live.isSpeaking { live.stopSpeaking(at: .immediate) }
                live.speak(Self.utterance(p.callout, root: p.root))
            }
            nowPlaying()
            report()
        }
        if r.needsBlock { makeBlock() }
        sendClock()
    }

    /// Where the block you hear is: its notes and grid, and how far into it the sound now leaving the speaker is
    /// (the renderer's last buffer, less the output latency, so a Bluetooth delay doesn't put the ball ahead).
    private func sendClock() {
        guard watching, active, let r = renderer, UIApplication.shared.applicationState == .active else { return }
        let c = r.clock
        guard c.id >= 0, let p = picks[c.id] else { return }
        let s = AVAudioSession.sharedInstance()
        let heard = Double(c.at) - (s.outputLatency + s.ioBufferDuration) * r.sampleRate
        shell?.sendToPage([
            "type": "practiceClock", "id": c.id, "playing": playing,
            "root": p.root, "item": p.item.name, "intervals": p.item.intervals, "notes": PracticeTheory.rep(p.item),
            "bpm": p.bpm, "step": p.step, "reps": c.reps,
            "repSixteenths": PracticeTheory.barsPerRep(p.item, step: p.step) * 16,
            "posS": (heard - Double(c.lead)) / r.sampleRate,       // seconds since the count-in's first click (< 0: the callout)
        ])
    }

    // MARK: lock screen

    private func nowPlaying() {
        guard active else { return }
        let title = picks[shownId].map { "\(PracticeTheory.rootNames[$0.root]) \($0.item.name) - \($0.bpm)" } ?? "Practice Loop"
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: "Practice Loop",
            MPMediaItemPropertyAlbumTitle: "Vetta",
            MPNowPlayingInfoPropertyIsLiveStream: true,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: Date().timeIntervalSince(startedAt),
        ]
    }

    private func commands() {
        let c = MPRemoteCommandCenter.shared()
        func on(_ cmd: MPRemoteCommand, _ run: @escaping @MainActor (ApexPracticeLoop) -> Void) {
            cmd.isEnabled = true
            let t = cmd.addTarget { [weak self] _ in
                guard let self else { return .commandFailed }
                // the command centre calls on the main thread; if it ever doesn't, the press is moved there
                if Thread.isMainThread { MainActor.assumeIsolated { run(self) } }
                else { DispatchQueue.main.async { MainActor.assumeIsolated { run(self) } } }
                return .success
            }
            targets.append((cmd, t))
        }
        on(c.playCommand) { $0.play() }
        on(c.pauseCommand) { $0.pause() }
        on(c.togglePlayPauseCommand) { $0.playing ? $0.pause() : $0.play() }
        on(c.nextTrackCommand) { $0.next() }
    }

    // MARK: interruptions, unplugged headphones, a changed or reset audio system

    private func observe() {
        let nc = NotificationCenter.default
        let s = AVAudioSession.sharedInstance()
        observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: s, queue: .main) { [weak self] note in
            let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
            let opts = AVAudioSession.InterruptionOptions(rawValue: (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0)
            MainActor.assumeIsolated { self?.interrupted(type, resume: opts.contains(.shouldResume)) }
        })
        observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: s, queue: .main) { [weak self] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init)
            MainActor.assumeIsolated { if reason == .oldDeviceUnavailable { self?.pause() } }
        })
        observers.append(nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: s, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.rebuild() }
        })
        observers.append(nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] note in
            MainActor.assumeIsolated {
                guard let self, let e = self.engine, (note.object as? AVAudioEngine) === e, self.playing else { return }
                // the co-driver changed the category, or the output changed: the engine stopped itself; start it again
                if !e.isRunning { do { try e.start() } catch { self.rebuild() } }
            }
        })
    }

    private func interrupted(_ type: AVAudioSession.InterruptionType?, resume: Bool) {
        guard active else { return }
        if type == .began {
            resumeAfterInterruption = playing
            if playing { pause() }
        } else if type == .ended {
            if resumeAfterInterruption && resume { self.resume() }
            resumeAfterInterruption = false
        }
    }

    /// The audio system was reset (or the engine won't start again): a new engine over the same renderer, same place.
    private func rebuild() {
        guard active else { return }
        let was = playing
        engine?.stop()
        engine = nil
        playing = false
        guard was else { return }
        ApexAudioSession.queue.async {
            let s = AVAudioSession.sharedInstance()
            try? s.setCategory(.playback, mode: .default, options: [])
            try? s.setActive(true)
            let rate = s.sampleRate
            Task { @MainActor [weak self] in self?.startEngine(rate: rate) }
        }
    }

    // MARK: the page

    private func report() {
        guard let shell else { return }
        var msg: [String: Any] = ["type": "practice", "active": active, "playing": playing]
        if let p = picks[shownId] { msg["title"] = p.title; msg["callout"] = p.callout; msg["reps"] = p.reps }
        if let d = try? JSONEncoder().encode(settings), let s = try? JSONSerialization.jsonObject(with: d) { msg["settings"] = s }
        if active && settings.sleepMin > 0 { msg["sleepLeftS"] = max(0, Double(settings.sleepMin) * 60 - Date().timeIntervalSince(startedAt)) }
        msg["range"] = rangeMessage
        shell.sendToPage(msg)
    }

    // MARK: the voice range test

    private var rangeMessage: [String: Any] {
        var m: [String: Any] = ["step": rangeStep ?? NSNull()]
        if let r = range {
            m["lo"] = r.lowerBound; m["hi"] = r.upperBound
            m["label"] = "\(PracticePitch.name(midi: r.lowerBound)) to \(PracticePitch.name(midi: r.upperBound))"
        }
        if let n = heard.now { m["now"] = PracticePitch.name(midi: n) }
        let best = rangeStep == "high" ? heard.high : heard.low
        if let b = best { m["best"] = PracticePitch.name(midi: b) }
        if let l = rangeLow { m["low"] = PracticePitch.name(midi: l) }
        if let e = rangeError { m["error"] = e }
        return m
    }

    private func sendRange() { var m = rangeMessage; m["type"] = "practiceRange"; shell?.sendToPage(m) }

    /// start: listen for the lowest note. done: keep what was heard and go on (low, then high, then the range is set).
    /// cancel: stop listening, keep the old range. clear: back to middle C's octave.
    private func rangeAction(_ step: String) {
        switch step {
        case "start":
            guard rangeStep == nil else { return }
            if shell?.isTalking == true { rangeError = "Convoy talk is using the microphone."; sendRange(); return }
            rangeError = nil; rangeLow = nil
            listen()
        case "done":
            guard let st = rangeStep else { return }
            let best = st == "low" ? heard.low : heard.high
            guard let b = best else { rangeError = "Didn't hear a held note yet. Hold one steady for a moment."; sendRange(); return }
            rangeError = nil
            if st == "low" {
                rangeLow = b
                rangeStep = "high"
                heard = (nil, nil, nil)
                listenGen += 1
                tracker.reset { [weak self] in self?.heard = (nil, nil, nil); self?.sendRange() }
                armTimeout()
            } else {
                let lo = min(rangeLow ?? b, b), hi = max(rangeLow ?? b, b)
                guard PracticeRange.usable(lo, hi) else {
                    endListening(error: "\(PracticePitch.name(midi: lo)) to \(PracticePitch.name(midi: hi)) is under an octave. Try again, as low and as high as you can.")
                    return
                }
                range = lo...hi
                endListening(error: nil)
                remakeNext()
            }
        case "cancel": if rangeStep != nil { endListening(error: nil) }
        case "clear":
            if rangeStep != nil { endListening(error: nil) }
            range = nil; rangeError = nil
            remakeNext()
        default: break
        }
        sendRange()
    }

    /// The queued block was picked for the old range: pick it again.
    private func remakeNext() {
        guard active, let r = renderer else { return }
        r.clearPending(); writeGen += 1; making = false; makeBlock()
    }

    private let tracker = RangeListener()

    private func listen() {
        if playing { resumeAfterRange = true; pause() }
        rangeStep = "low"
        heard = (nil, nil, nil)
        listenGen += 1
        let gen = listenGen
        sendRange()
        Self.askForMicrophone { ok in
            Task { @MainActor [weak self] in
                guard let self, self.rangeStep != nil, gen == self.listenGen else { return }
                guard ok else { self.endListening(error: "Vetta can't hear the microphone. Allow it in Settings → Vetta → Microphone."); return }
                self.shell?.setPracticeListening(true)
                // after the shell's session change (the same queue), start listening
                ApexAudioSession.queue.async { Task { @MainActor [weak self] in self?.startListener(gen) } }
            }
        }
    }

    private func startListener(_ gen: Int) {
        guard rangeStep != nil, gen == listenGen, listener == nil else { return }
        let e = AVAudioEngine()
        let input = e.inputNode
        let fmt = input.outputFormat(forBus: 0)
        guard fmt.sampleRate > 0, fmt.channelCount > 0 else { endListening(error: "No microphone to listen with."); return }
        tracker.begin(sampleRate: fmt.sampleRate) { [weak self] now, low, high in
            Task { @MainActor [weak self] in
                guard let self, self.rangeStep != nil else { return }
                self.heard = (now, low, high)
                self.sendRange()
            }
        }
        let t = tracker
        input.installTap(onBus: 0, bufferSize: 2048, format: fmt, block: Self.tap(t))
        e.prepare()
        do { try e.start() } catch {
            input.removeTap(onBus: 0)
            endListening(error: "Couldn't listen: \(error.localizedDescription)")
            return
        }
        listener = e
        armTimeout()
    }

    /// The audio thread's and the permission prompt's sides: nonisolated, so neither closure is the main actor's.
    nonisolated private static func tap(_ t: RangeListener) -> AVAudioNodeTapBlock { { buf, _ in t.feed(buf) } }
    nonisolated private static func askForMicrophone(_ done: @escaping @Sendable (Bool) -> Void) {
        AVAudioApplication.requestRecordPermission { ok in done(ok) }
    }

    /// A step that is never finished stops by itself after 15 s, keeping what it heard.
    private func armTimeout() {
        let gen = listenGen, st = rangeStep
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, gen == self.listenGen, self.rangeStep == st, st != nil else { return }
                let best = st == "low" ? self.heard.low : self.heard.high
                if best != nil { self.rangeAction("done") } else { self.endListening(error: "Didn't hear a held note. Try again and hold each one for a moment.") }
            }
        }
    }

    private func endListening(error: String?) {
        listenGen += 1
        rangeStep = nil
        rangeLow = nil
        rangeError = error
        heard = (nil, nil, nil)
        if let e = listener {
            e.inputNode.removeTap(onBus: 0)
            e.stop()
            listener = nil
        }
        tracker.end()
        shell?.setPracticeListening(false)
        if resumeAfterRange { resumeAfterRange = false; resume() }
        sendRange()
        report()
    }
}

/// The microphone's buffers, read for their pitch on a queue of their own (never the audio thread or the main thread):
/// mono, brought down to about 16 kHz (plenty for a voice's fundamental), and fed to PracticeRangeTracker. Only what it
/// heard (the note now, the lowest and highest held) goes back; the samples are dropped.
private final class RangeListener: @unchecked Sendable {
    private let queue = DispatchQueue(label: "app.vetta.practice-range", qos: .userInitiated)
    private var tracker: PracticeRangeTracker?
    private var factor = 1
    private var report: ((Int?, Int?, Int?) -> Void)?
    private var last: (Int?, Int?, Int?) = (nil, nil, nil)

    func begin(sampleRate: Double, report: @escaping @Sendable (Int?, Int?, Int?) -> Void) {
        queue.async {
            self.factor = max(1, Int(sampleRate / 16000))
            self.tracker = PracticeRangeTracker(sampleRate: sampleRate / Double(self.factor))
            self.report = report
            self.last = (nil, nil, nil)
        }
    }

    func reset(then: @escaping @MainActor @Sendable () -> Void) {
        queue.async {
            self.tracker?.reset(); self.last = (nil, nil, nil)
            Task { @MainActor in then() }
        }
    }

    func end() { queue.async { self.tracker = nil; self.report = nil } }

    func feed(_ buf: AVAudioPCMBuffer) {
        guard let ch = buf.floatChannelData else { return }
        let n = Int(buf.frameLength)
        let x = Array(UnsafeBufferPointer(start: ch[0], count: n))
        queue.async {
            guard let t = self.tracker else { return }
            let f = self.factor
            let down: [Float] = f == 1 ? x : stride(from: 0, to: x.count - f + 1, by: f).map { i in
                var s: Float = 0
                for j in 0..<f { s += x[i + j] }
                return s / Float(f)
            }
            t.feed(down)
            let now = (t.now, t.lowest, t.highest)
            if now != self.last { self.last = now; self.report?(now.0, now.1, now.2) }
        }
    }
}

/// The callout's buffers as the synthesizer hands them over (on its own queue), turned into samples at the engine's rate.
private final class CalloutBox: @unchecked Sendable {
    private let lock = NSLock()
    private var chunks: [(rate: Double, data: [Float])] = []

    func add(_ b: AVAudioPCMBuffer) {
        let n = Int(b.frameLength)
        guard n > 0 else { return }
        var d = [Float](repeating: 0, count: n)
        if let f = b.floatChannelData { for i in 0..<n { d[i] = f[0][i] } }
        else if let s = b.int16ChannelData { for i in 0..<n { d[i] = Float(s[0][i]) / 32768 } }
        else if let s = b.int32ChannelData { for i in 0..<n { d[i] = Float(s[0][i]) / 2_147_483_648 } }
        else { return }
        lock.lock(); chunks.append((b.format.sampleRate, d)); lock.unlock()
    }

    func samples(at rate: Double) -> [Float] {
        lock.lock(); let all = chunks; lock.unlock()
        guard let src = all.first?.rate, src > 0 else { return [] }
        let input = all.flatMap(\.data)
        guard !input.isEmpty else { return [] }
        let ratio = src / rate
        let count = Int(Double(input.count) / ratio)
        var out = [Float](repeating: 0, count: count)
        for i in 0..<count {                                      // linear resampling: speech, not music
            let x = Double(i) * ratio
            let j = Int(x), t = Float(x - Double(j))
            let a = input[min(j, input.count - 1)], b = input[min(j + 1, input.count - 1)]
            out[i] = a + (b - a) * t
        }
        let peak = out.reduce(0) { max($0, abs($1)) }
        if peak > 0.0001 { let g = 0.85 / peak; for i in 0..<count { out[i] *= g } }
        return out
    }
}
