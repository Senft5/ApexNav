# One-time setup for rendering the cloned voice on a Windows PC with an NVIDIA RTX 50-series GPU.
# Run in PowerShell from the repo root:  powershell -ExecutionPolicy Bypass -File tools\local\setup_windows.ps1
# Uses Python 3.11 (every package has a ready-made wheel there; 3.13 has none for numpy 1.x and would need a C compiler).
$ErrorActionPreference = "Stop"
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "Installing ffmpeg..."; winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
  Write-Host "ffmpeg installed. Close and reopen PowerShell, then rerun this script."; exit 0
}
$have311 = $false
try { & py -3.11 --version *> $null; if ($LASTEXITCODE -eq 0) { $have311 = $true } } catch {}
if (-not $have311) {
  Write-Host "Installing Python 3.11..."; winget install --id Python.Python.3.11 -e --accept-source-agreements --accept-package-agreements
  Write-Host "Python 3.11 installed. Close and reopen PowerShell, then rerun this script."; exit 0
}
if (Test-Path .venv-voice) { Remove-Item -Recurse -Force .venv-voice }
& py -3.11 -m venv .venv-voice
$py = ".\.venv-voice\Scripts\python.exe"
& $py -m pip install --upgrade pip
# RTX 5080 (Blackwell, sm_120) needs PyTorch built for CUDA 12.8 or newer. Chatterbox pins torch 2.6,
# which cannot drive this GPU, so install torch first and Chatterbox without its pins.
& $py -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
& $py -m pip install chatterbox-tts --no-deps
& $py -m pip install "numpy<2" "librosa==0.11.0" s3tokenizer "transformers==5.2.0" "diffusers==0.29.0" `
  resemble-perth "conformer==0.3.2" "safetensors==0.5.3" spacy-pkuseg "pykakasi==2.3.0" pyloudnorm omegaconf "setuptools<81" soundfile huggingface_hub
& $py -c "import numpy, torch; print('numpy', numpy.__version__, '| torch', torch.__version__, '| cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"
Write-Host "Setup done. Next: .\.venv-voice\Scripts\python.exe tools\local\render_own.py"
