; Inno Setup script to create a Windows installer for Devi Jewellers Player
; Requires Inno Setup (https://jrsoftware.org/isinfo.php) on the build machine.
;
; Usage (after building EXE with windows_build_gui_exe.bat):
;   1. Open this .iss file in Inno Setup Compiler
;   2. Click Build -> Compile
;   3. The resulting setup .exe will be in the Output folder

[Setup]
AppId={{DEVI-JEWELLERS-PLAYER-GUI}
AppName=Devi Jewellers Player
AppVersion=1.0.0
AppPublisher=Devi Jewellers
DefaultDirName={pf}\Devi Jewellers Player
DefaultGroupName=Devi Jewellers Player
DisableProgramGroupPage=yes
OutputBaseFilename=DeviJewellersPlayerSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
; Use the same icon as the app if available
SetupIconFile=static\app_icon.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Main executable built by PyInstaller
Source: "dist\DeviJewellersPlayer.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Desktop shortcut
Name: "{commondesktop}\Devi Jewellers Player"; Filename: "{app}\DeviJewellersPlayer.exe"; IconFilename: "{app}\DeviJewellersPlayer.exe"
; Start menu shortcut
Name: "{group}\Devi Jewellers Player"; Filename: "{app}\DeviJewellersPlayer.exe"; IconFilename: "{app}\DeviJewellersPlayer.exe"

[Run]
; Run the app immediately after finishing installation (optional)
Filename: "{app}\DeviJewellersPlayer.exe"; Description: "Launch Devi Jewellers Player"; Flags: nowait postinstall skipifsilent
