"""Render legacy WMF diagrams for browser clients without altering source files."""

import os
import shutil
import struct
import subprocess
import tempfile


def convert_wmf_to_png(data, file_name):
    if not str(file_name or '').lower().endswith('.wmf') or len(data)>16*1024*1024:
        return None
    executable=shutil.which('wmf2gd')
    if not executable:
        return None
    try:
        with tempfile.TemporaryDirectory(prefix='gewu-wmf-') as directory:
            source=os.path.join(directory,'source.wmf')
            target=os.path.join(directory,'rendered.png')
            with open(source,'wb') as handle:
                handle.write(data)
            result=subprocess.run(
                [executable,'-t','png','--maxwidth=1600','--maxheight=1600','--maxpect','-o',target,source],
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20,
            )
            if result.returncode!=0 or not os.path.isfile(target) or os.path.getsize(target)>32*1024*1024:
                return None
            with open(target,'rb') as handle:
                png=handle.read()
            if len(png)<33 or png[:8]!=b'\x89PNG\r\n\x1a\n' or png[12:16]!=b'IHDR':
                return None
            width,height=struct.unpack('>II',png[16:24])
            if not (0<width<=1600 and 0<height<=1600):
                return None
            return png
    except (OSError,ValueError,subprocess.SubprocessError,TimeoutError):
        return None
