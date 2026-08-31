' 静默后台启动 League Akari 平板推送工具（无控制台窗口）
' 把本文件的快捷方式放进 shell:startup 即可开机自启。
Dim fso, shell, dir
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = dir
shell.Run "node.exe """ & dir & "\publisher.mjs""", 0, False
