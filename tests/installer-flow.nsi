; Exercise the production NSIS pages without installing or changing registry/data.
Unicode true
RequestExecutionLevel user
Name "青竹桌宠 · 安装流程验收（不安装）"
OutFile "${QZ_ROOT}\tests\results\installer-flow.exe"
InstallDir "$EXEDIR\installer-flow-data"
!include MUI2.nsh
!include "${QZ_ROOT}\node_modules\app-builder-lib\templates\nsis\include\StdUtils.nsh"
!addplugindir /x86-unicode "${QZ_PLUGINS}"
!define BUILD_RESOURCES_DIR "${QZ_ROOT}\build"
!define APP_FILENAME "installer-flow-data"
!define APP_PRODUCT_FILENAME "not-an-installed-application"
!include "${QZ_ROOT}\build\installer.nsh"
!insertmacro customPageAfterChangeDir
!insertmacro MUI_PAGE_INSTFILES
!insertmacro customFinishPage
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro customHeader
Section
  DetailPrint "仅验证页面流转，不安装软件。"
  Sleep 500
SectionEnd
