@echo off
REM Convenience launcher for Windows. Run from the project root.
REM Sets up PATH for Node and clears npm temp.
set PATH=C:\Program Files\nodejs;%PATH%
set TMP=D:\npm-tmp
set TEMP=D:\npm-tmp
set npm_config_cache=D:\npm-cache
set ELECTRON_CACHE=D:\electron-cache
set ELECTRON_DOWNLOAD_CACHE=D:\electron-download
npm run dev
