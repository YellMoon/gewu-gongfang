import sys
from pathlib import Path

import pythoncom
import win32com.client

source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
target.parent.mkdir(parents=True, exist_ok=True)

pythoncom.CoInitialize()
word = win32com.client.DispatchEx('Word.Application')
word.Visible = False
word.DisplayAlerts = 0
word.AutomationSecurity = 3
document = None
try:
    document = word.Documents.Open(
        str(source), ConfirmConversions=False, ReadOnly=True,
        AddToRecentFiles=False, OpenAndRepair=True, NoEncodingDialog=True,
    )
    document.SaveAs2(str(target), FileFormat=16, AddToRecentFiles=False)
    print(f'{source.name}\t{target.stat().st_size}', flush=True)
finally:
    if document is not None:
        document.Close(False)
    word.Quit()
    pythoncom.CoUninitialize()
