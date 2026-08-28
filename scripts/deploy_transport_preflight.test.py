import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("gewu_deploy", ROOT / "scripts" / "deploy.py")
subject = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(subject)


class SocketFixture:
    def __init__(self, chunks):
        self.chunks = list(chunks)
        self.timeout = None
        self.closed = False

    def settimeout(self, value):
        self.timeout = value

    def recv(self, _size):
        return self.chunks.pop(0) if self.chunks else b""

    def close(self):
        self.closed = True


class DeployTransportPreflightTests(unittest.TestCase):
    def test_accepts_a_complete_ssh_banner_and_closes_probe_socket(self):
        sock = SocketFixture([b"SSH-2.0-OpenSSH_9.2\r\n"])
        observed = subject.assert_ssh_transport(
            host="cloud.example.test", port=22, connector=lambda address, timeout: sock
        )
        self.assertEqual(observed, "SSH-2.0-OpenSSH_9.2")
        self.assertEqual(sock.timeout, subject.SSH_BANNER_TIMEOUT_SECONDS)
        self.assertTrue(sock.closed)

    def test_rejects_a_socket_that_never_delivers_an_ssh_banner(self):
        sock = SocketFixture([b""])
        with self.assertRaisesRegex(RuntimeError, "CLOUD_DEPLOY_SSH_BANNER_UNAVAILABLE"):
            subject.assert_ssh_transport(
                host="cloud.example.test", port=22, connector=lambda address, timeout: sock
            )
        self.assertTrue(sock.closed)


if __name__ == "__main__":
    unittest.main()
