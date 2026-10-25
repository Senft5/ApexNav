# Render the cloned voice on your own PC (RTX 5080, Windows)

You need: Git (the setup script installs Python 3.11 and ffmpeg itself), an NVIDIA driver that supports CUDA 12.8 (any 2025+ driver does).

1. `git clone https://github.com/Senft5/ApexNav` (or `git pull`), then `git checkout claude/lucid-pascal-82cnud`.
2. `powershell -ExecutionPolicy Bypass -File tools\local\setup_windows.ps1`
   (if it installs ffmpeg it asks you to reopen PowerShell and rerun it). The last line must say
   `cuda True NVIDIA GeForce RTX 5080`. If it says `cuda False`, stop and send me that output.
3. `.\.venv-voice\Scripts\python.exe tools\local\render_own.py`
   Renders ~900 clips in your voice (word bank, the exact calls, the common phrases, every corner+modifier).
   Your real recordings are merged in automatically. Safe to stop with Ctrl+C and rerun later.
   Expected speed: 1–3 s a clip.
4. Optional, for the Kokoro fine-tune: `... render_own.py --train` renders 4,000 training phrases into `train_own\`.
5. Publish: `git checkout -b own-voice`, `git add web/voices/own web/voices/index.json`, `git commit -m "My Voice bank"`,
   `git push -u origin own-voice`, then tell me. (Do not commit `train_own\`; it is large and gitignored.)

`ref_partA.wav` is the clean reference passage from your recording; `recorded\` holds the 54 real call clips
cut from your read-through.
