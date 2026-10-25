# One-time setup for rendering the cloned voice on a Windows PC with an NVIDIA RTX 50-series GPU.
# Run in PowerShell from the repo root:  powershell -ExecutionPolicy Bypass -File tools\local\setup_windows.ps1
$ErrorActionPreference = "Stop"
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "Installing ffmpeg..."; winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
  Write-Host "ffmpeg installed. Close and reopen PowerShell, then rerun this script."; exit 0
}
python -m venv .venv-voice
& .\.venv-voice\Scripts\python.exe -m pip install --upgrade pip
# RTX 5080 (Blackwell, sm_120) needs PyTorch built for CUDA 12.8 or newer. Chatterbox pins torch 2.6,
# which cannot drive this GPU, so install torch first and Chatterbox without its pins.
& .\.venv-voice\Scripts\python.exe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
& .\.venv-voice\Scripts\python.exe -m pip install chatterbox-tts --no-deps
& .\.venv-voice\Scripts\python.exe -m pip install "numpy<2" "librosa==0.11.0" s3tokenizer "transformers==5.2.0" "diffusers==0.29.0" `
  resemble-perth "conformer==0.3.2" "safetensors==0.5.3" spacy-pkuseg "pykakasi==2.3.0" pyloudnorm omegaconf "setuptools<81" soundfile huggingface_hub
& .\.venv-voice\Scripts\python.exe -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"
Write-Host "Setup done. Next: .\.venv-voice\Scripts\python.exe tools\local\render_own.py"
