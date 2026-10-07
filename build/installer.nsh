; Single-page installer. Directory selection lives in our custom page.
!include nsDialogs.nsh
!include FileFunc.nsh
!define MUI_BGCOLOR "F8F7F2"
!define MUI_TEXTCOLOR "254C40"
!define MUI_INSTFILESPAGE_COLORS "254C40 F8F7F2"

!macro customHeader
  SetFont "Microsoft YaHei UI" 9
  BrandingText " "
!macroend

; Keep an existing machine-wide installation in its original mode.
!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${If} $hasPerMachineInstallation == "1"
    ${AndIf} $hasPerUserInstallation != "1"
      StrCpy $isForceMachineInstall "1"
    ${Else}
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
Var QzPage
Var QzPath
Var QzImage
Var QzBitmap
Var QzFont
Var QzTitleFont
Var QzDpi
Var QzWidth
Var QzHeight
Var QzControl
Var QzButton

!macro QzPlace CONTROL X Y W H
  IntOp $R0 ${X} * $QzDpi
  IntOp $R0 $R0 / 96
  IntOp $R1 ${Y} * $QzDpi
  IntOp $R1 $R1 / 96
  IntOp $R2 ${W} * $QzDpi
  IntOp $R2 $R2 / 96
  IntOp $R3 ${H} * $QzDpi
  IntOp $R3 $R3 / 96
  System::Call 'user32::MoveWindow(p ${CONTROL}, i $R0, i $R1, i $R2, i $R3, i 1)'
!macroend

!macro QzLabel X Y W H TEXT COLOR FONT
  ${NSD_CreateLabel} 0 0 1 1 "${TEXT}"
  Pop $QzControl
  !insertmacro QzPlace $QzControl ${X} ${Y} ${W} ${H}
  SetCtlColors $QzControl ${COLOR} transparent
  SendMessage $QzControl ${WM_SETFONT} ${FONT} 1
!macroend

!macro QzHide ID
  GetDlgItem $0 $HWNDPARENT ${ID}
  ShowWindow $0 ${SW_HIDE}
!macroend

!macro QzFunctions
Function QzShell
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT)i.r0'
  StrCpy $QzDpi $0
  ${If} $QzDpi == 0
    StrCpy $QzDpi 96
  ${EndIf}
  IntOp $QzWidth 560 * $QzDpi
  IntOp $QzWidth $QzWidth / 96
  IntOp $QzHeight 360 * $QzDpi
  IntOp $QzHeight $QzHeight / 96
  System::Call 'user32::SetWindowPos(p $HWNDPARENT,p0,i0,i0,i $QzWidth,i $QzHeight,i 0x16)'
  SetCtlColors $HWNDPARENT 254C40 F8F7F2
  !insertmacro QzHide 1
  !insertmacro QzHide 2
  !insertmacro QzHide 3
  !insertmacro QzHide 1028
  !insertmacro QzHide 1034
  !insertmacro QzHide 1035
  !insertmacro QzHide 1036
  !insertmacro QzHide 1037
  !insertmacro QzHide 1038
  !insertmacro QzHide 1039
  !insertmacro QzHide 1045
  !insertmacro QzHide 1046
  !insertmacro QzHide 1256
FunctionEnd

Function QzCreatePage
  Call QzShell
  nsDialogs::Create 1018
  Pop $QzPage
  SetCtlColors $QzPage 254C40 F8F7F2
  System::Call '*(i0,i0,i0,i0)p.r0'
  System::Call 'user32::GetClientRect(p $HWNDPARENT,p r0)'
  System::Call '*$0(i,i,i.r1,i.r2)'
  System::Free $0
  System::Call 'user32::MoveWindow(p $QzPage,i0,i0,i r1,i r2,i1)'
  InitPluginsDir
  File /oname=$PLUGINSDIR\installer-background.bmp "${BUILD_RESOURCES_DIR}\installer-background.bmp"
  ${NSD_CreateBitmap} 0 0 100% 100% ""
  Pop $QzImage
  ${NSD_SetStretchedImage} $QzImage "$PLUGINSDIR\installer-background.bmp" $QzBitmap
  EnableWindow $QzImage 0
  CreateFont $QzFont "Microsoft YaHei UI" 10 400
  CreateFont $QzTitleFont "Microsoft YaHei UI" 22 600
  !insertmacro QzLabel 36 34 310 42 "青竹桌宠" 254C40 $QzTitleFont
FunctionEnd

Function QzBrowse
  Pop $0
  ${NSD_GetText} $QzPath $0
  nsDialogs::SelectFolderDialog "选择安装位置" "$0"
  Pop $0
  ${If} $0 != error
    ${GetFileName} "$0" $1
    ${If} $1 != "${APP_FILENAME}"
      StrCpy $0 "$0\${APP_FILENAME}"
    ${EndIf}
    ${NSD_SetText} $QzPath "$0"
  ${EndIf}
FunctionEnd

Function QzAdvance
  Pop $0
  SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
FunctionEnd

Function QzStart
  Call QzCreatePage
  !insertmacro QzLabel 38 82 350 25 "让喜欢的人物陪在桌边" 748076 $QzFont
  !insertmacro QzLabel 38 136 280 24 "安装位置" 465B50 $QzFont
  ${NSD_CreateDirRequest} 0 0 1 1 "$INSTDIR"
  Pop $QzPath
  !insertmacro QzPlace $QzPath 38 166 386 30
  SendMessage $QzPath ${WM_SETFONT} $QzFont 1
  ${NSD_CreateButton} 0 0 1 1 "更改"
  Pop $QzControl
  !insertmacro QzPlace $QzControl 438 166 76 30
  SendMessage $QzControl ${WM_SETFONT} $QzFont 1
  ${NSD_OnClick} $QzControl QzBrowse
  !insertmacro QzLabel 38 210 430 24 "内置韩立，其他人物可在软件内添加。" 748076 $QzFont
  ${NSD_CreateButton} 0 0 1 1 "开始安装"
  Pop $QzButton
  !insertmacro QzPlace $QzButton 382 260 132 38
  SendMessage $QzButton ${WM_SETFONT} $QzFont 1
  ${NSD_OnClick} $QzButton QzAdvance
  System::Call 'user32::SetWindowPos(p $QzImage,p1,i0,i0,i0,i0,i0x13)'
  nsDialogs::Show
  ${NSD_FreeImage} $QzBitmap
  Delete $PLUGINSDIR\installer-background.bmp
  System::Call 'gdi32::DeleteObject(p $QzFont)'
  System::Call 'gdi32::DeleteObject(p $QzTitleFont)'
FunctionEnd

Function QzValidate
  ${NSD_GetText} $QzPath $INSTDIR
  ${GetRoot} "$INSTDIR" $0
  ${If} $INSTDIR == ""
  ${OrIf} $0 == ""
  ${OrIf} $INSTDIR == $0
  ${OrIf} $INSTDIR == "$0\"
    MessageBox MB_OK|MB_ICONEXCLAMATION "请选择完整的安装文件夹。"
    Abort
  ${EndIf}
  ${If} $INSTDIR == "$WINDIR"
  ${OrIf} $INSTDIR == "$SYSDIR"
    MessageBox MB_OK|MB_ICONEXCLAMATION "请选择其他安装文件夹。"
    Abort
  ${EndIf}
FunctionEnd

Function QzProgress
  ; MUI_PAGE_FINISH normally enables this in GUIINIT. Our custom finish page
  ; replaces that macro, so explicitly leave InstFiles when its section ends.
  SetAutoClose true
  Call QzShell
  FindWindow $QzPage "#32770" "" $HWNDPARENT
  !insertmacro QzPlace $QzPage 36 74 478 200
  SetCtlColors $QzPage 254C40 F8F7F2
  GetDlgItem $0 $QzPage 1006
  SendMessage $0 ${WM_SETTEXT} 0 "STR:正在安装…"
  !insertmacro QzPlace $0 0 10 470 25
  GetDlgItem $0 $QzPage 1004
  !insertmacro QzPlace $0 0 48 470 12
  GetDlgItem $0 $QzPage 1016
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $QzPage 1027
  ShowWindow $0 ${SW_HIDE}
FunctionEnd

Function QzOpen
  Pop $0
  ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_PRODUCT_FILENAME}.exe" "open" ""
  SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
FunctionEnd

Function QzFinish
  Call QzCreatePage
  !insertmacro QzLabel 38 98 360 32 "安装完成" 465B50 $QzFont
  ${NSD_CreateButton} 0 0 1 1 "完成"
  Pop $QzControl
  !insertmacro QzPlace $QzControl 248 254 96 40
  SendMessage $QzControl ${WM_SETFONT} $QzFont 1
  ${NSD_OnClick} $QzControl QzAdvance
  ${NSD_CreateButton} 0 0 1 1 "打开青竹桌宠"
  Pop $QzButton
  !insertmacro QzPlace $QzButton 358 254 156 40
  SendMessage $QzButton ${WM_SETFONT} $QzFont 1
  ${NSD_OnClick} $QzButton QzOpen
  System::Call 'user32::SetWindowPos(p $QzImage,p1,i0,i0,i0,i0,i0x13)'
  nsDialogs::Show
  ${NSD_FreeImage} $QzBitmap
  System::Call 'gdi32::DeleteObject(p $QzFont)'
  System::Call 'gdi32::DeleteObject(p $QzTitleFont)'
FunctionEnd
!macroend
!endif


!macro customPageAfterChangeDir
  !insertmacro QzFunctions
  Page custom QzStart QzValidate
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW QzProgress
!macroend

!macro customFinishPage
  Page custom QzFinish
!macroend
