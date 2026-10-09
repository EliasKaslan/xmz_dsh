@echo off
rem DeepSeek Harness launcher - command line entry.
rem Usage: dsh.cmd [--port N] [--workspace DIR] [--new] [--skip-update] [--force-update] [--check]
node "%~dp0launch-dsh.mjs" %*
exit /b %ERRORLEVEL%
