@echo off
setlocal
set "DV_EDGE_EXE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "DV_EDGE_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined DV_EDGE_EXE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "DV_EDGE_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined DV_EDGE_EXE if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" set "DV_EDGE_EXE=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
if not defined DV_EDGE_EXE (
  echo Microsoft Edge was not found in the standard installation folders.
  pause
  exit /b 1
)
echo Fully exit Edge before using this launcher so the feature flags take effect.
echo This opens your regular Edge profile. No separate test profile is created.
start "" "%DV_EDGE_EXE%" --new-window --enable-features=MediaFoundationClearPlayback,PlatformEncryptedDolbyVision,AllowClearDolbyVisionInMseWhenPlatformEncryptedDvEnabled "https://www.bilibili.com/"
endlocal
