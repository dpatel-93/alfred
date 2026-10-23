' Hidden launcher for the nightly brain Librarian (Windows Task Scheduler).
' Runs brain-librarian.mjs from this folder with no console window.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run "node """ & here & "\brain-librarian.mjs"" --quiet", 0, True
