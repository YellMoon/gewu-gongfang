from __future__ import annotations

import base64
import io
import os
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import Mock, patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import metafile_image
import parse_word

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZxkAAAAASUVORK5CYII=')


class MetafileImageTests(unittest.TestCase):
    def converter(self, payload=PNG, code=0):
        paths=[]
        def run(argv, **kwargs):
            self.assertEqual(argv[0], '/usr/bin/wmf2gd')
            self.assertNotIn('shell', kwargs)
            self.assertEqual(kwargs['timeout'], 20)
            self.assertIn('--maxpect', argv)
            source=argv[-1]
            target=argv[argv.index('-o')+1]
            self.assertEqual(Path(source).read_bytes(), b'WMF source bytes')
            paths.extend([source,target])
            Path(target).write_bytes(payload)
            return Mock(returncode=code)
        return run,paths

    def test_linux_wmf_outputs_bounded_png_and_removes_its_temporary_files(self):
        run,paths=self.converter()
        with patch.object(metafile_image.shutil, 'which', return_value='/usr/bin/wmf2gd'), patch.object(metafile_image.subprocess, 'run', side_effect=run):
            self.assertEqual(metafile_image.convert_wmf_to_png(b'WMF source bytes','choice.WMF'), PNG)
        self.assertTrue(paths)
        self.assertTrue(all(not os.path.exists(path) for path in paths))

    def test_non_wmf_or_missing_converter_is_not_mislabelled_as_png(self):
        with patch.object(metafile_image.shutil, 'which', return_value=None), patch.object(metafile_image.subprocess, 'run') as run:
            for filename in ('choice.wmf','choice.emf','photo.png'):
                self.assertIsNone(metafile_image.convert_wmf_to_png(b'WMF source bytes',filename))
            run.assert_not_called()

    def test_failed_invalid_or_oversized_conversion_keeps_original_asset(self):
        huge=PNG[:16]+struct.pack('>II',100000,100000)+PNG[24:]
        for data,code in ((PNG,1),(b'not PNG',0),(huge,0)):
            run,paths=self.converter(data,code)
            with self.subTest(code=code), patch.object(metafile_image.shutil, 'which', return_value='/usr/bin/wmf2gd'), patch.object(metafile_image.subprocess, 'run', side_effect=run):
                self.assertIsNone(metafile_image.convert_wmf_to_png(b'WMF source bytes','choice.wmf'))
            self.assertTrue(all(not os.path.exists(path) for path in paths))
        with patch.object(metafile_image.shutil, 'which', return_value='/usr/bin/wmf2gd'), patch.object(metafile_image.subprocess, 'run', side_effect=TimeoutError()):
            self.assertIsNone(metafile_image.convert_wmf_to_png(b'WMF source bytes','choice.wmf'))

    def test_asset_keeps_source_part_and_original_format_after_png_conversion(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as archive:
            archive.writestr('word/media/choice.wmf', b'WMF source bytes')
        with zipfile.ZipFile(stream) as archive, patch.object(parse_word,'_convert_windows_metafile_to_png',return_value=PNG):
            asset=parse_word._asset_from_part(archive,'word/media/choice.wmf','image')
        self.assertEqual(asset['mime_type'],'image/png')
        self.assertEqual(asset['file_name'],'choice.png')
        self.assertEqual(asset['source_part'],'word/media/choice.wmf')
        self.assertEqual(asset['original_file_name'],'choice.wmf')


if __name__=='__main__':
    unittest.main()
