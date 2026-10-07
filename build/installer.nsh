; Keep the standard directory selection and upgrade handling, with branded MUI pages.
!define MUI_BGCOLOR "F6F0DF"
!define MUI_TEXTCOLOR "244C3E"
!define MUI_INSTFILESPAGE_COLORS "244C3E F6F0DF"
!define MUI_HEADERIMAGE_BITMAP_NOSTRETCH
!define MUI_UNHEADERIMAGE_BITMAP_NOSTRETCH

!macro customHeader
  SetFont "Microsoft YaHei UI" 9
  BrandingText "青竹桌宠 · ${VERSION}"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎来到青竹桌宠"
  !define MUI_WELCOMEPAGE_TEXT "一隅青竹，常伴桌边。$\r$\n$\r$\n让喜欢的人物来到桌面，陪你阅读、工作与休息。$\r$\n$\r$\n安装程序内置韩立，其他人物可在软件中按需安装。$\r$\n$\r$\n接下来可以选择安装位置。更新会保留你的人物包和设置。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "青竹已至，随时相伴"
  !define MUI_FINISHPAGE_TEXT "青竹桌宠已安装完成。$\r$\n$\r$\n从桌面或开始菜单打开「青竹桌宠」，选择人物并点击「邀至桌面」。$\r$\n$\r$\n右键桌面人物可打开设置或暂停播放；托盘菜单可以找回人物。"
  !insertmacro MUI_PAGE_FINISH
!macroend
