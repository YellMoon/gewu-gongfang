import argparse
import json
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import error, request
from urllib.parse import urlparse


LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


def percentile(values, pct):
  if not values:
    return 0.0
  ordered = sorted(values)
  index = min(len(ordered) - 1, max(0, int(round((pct / 100) * (len(ordered) - 1)))))
  return ordered[index]


def ensure_safe_target(base_url, allow_remote):
  host = urlparse(base_url).hostname
  if host not in LOCAL_HOSTS and not allow_remote:
    raise SystemExit(
      "Refusing to run load test against a non-local target. "
      "Pass --allow-remote only for an explicit staging environment."
    )


def fetch_once(url, timeout, index):
  started = time.perf_counter()
  headers = {
    "x-trace-id": f"load-test-{int(time.time())}-{index}",
    "user-agent": "gewu-load-test/1.0",
  }
  try:
    req = request.Request(url, headers=headers)
    with request.urlopen(req, timeout=timeout) as resp:
      body = resp.read(512)
      status = resp.status
      ok = 200 <= status < 400
      return {
        "ok": ok,
        "status": status,
        "latencyMs": (time.perf_counter() - started) * 1000,
        "bytes": len(body),
      }
  except error.HTTPError as exc:
    return {
      "ok": False,
      "status": exc.code,
      "latencyMs": (time.perf_counter() - started) * 1000,
      "error": str(exc),
    }
  except Exception as exc:
    return {
      "ok": False,
      "status": 0,
      "latencyMs": (time.perf_counter() - started) * 1000,
      "error": str(exc),
    }


def run_load(base_url, paths, requests_total, concurrency, timeout, allow_remote):
  ensure_safe_target(base_url, allow_remote)
  urls = [base_url.rstrip("/") + path for path in paths]
  started = time.perf_counter()
  results = []

  with ThreadPoolExecutor(max_workers=concurrency) as pool:
    futures = [
      pool.submit(fetch_once, urls[index % len(urls)], timeout, index)
      for index in range(requests_total)
    ]
    for future in as_completed(futures):
      results.append(future.result())

  elapsed = max(time.perf_counter() - started, 0.001)
  latencies = [item["latencyMs"] for item in results]
  ok_count = sum(1 for item in results if item["ok"])
  failures = [item for item in results if not item["ok"]]
  by_status = {}
  for item in results:
    key = str(item["status"])
    by_status[key] = by_status.get(key, 0) + 1

  return {
    "baseUrl": base_url,
    "paths": paths,
    "totalRequests": len(results),
    "success": ok_count,
    "failed": len(failures),
    "successRate": round(ok_count / len(results), 4) if results else 0,
    "rps": round(len(results) / elapsed, 2),
    "latencyMs": {
      "avg": round(statistics.mean(latencies), 2) if latencies else 0,
      "p50": round(percentile(latencies, 50), 2),
      "p95": round(percentile(latencies, 95), 2),
      "p99": round(percentile(latencies, 99), 2),
      "max": round(max(latencies), 2) if latencies else 0,
    },
    "statusCodes": by_status,
    "sampleErrors": failures[:5],
  }


class SelfTestHandler(BaseHTTPRequestHandler):
  def do_GET(self):
    if self.path.startswith("/api/health"):
      payload = json.dumps({"ok": True, "traceId": self.headers.get("x-trace-id")}).encode("utf-8")
      self.send_response(200)
      self.send_header("content-type", "application/json")
      self.send_header("content-length", str(len(payload)))
      self.end_headers()
      self.wfile.write(payload)
      return
    self.send_response(404)
    self.end_headers()

  def log_message(self, _format, *_args):
    return


def run_self_test():
  server = ThreadingHTTPServer(("127.0.0.1", 0), SelfTestHandler)
  thread = threading.Thread(target=server.serve_forever, daemon=True)
  thread.start()
  try:
    base_url = f"http://127.0.0.1:{server.server_port}"
    result = run_load(base_url, ["/api/health"], 20, 4, 2, False)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["failed"] != 0 or result["totalRequests"] != 20:
      raise SystemExit(1)
  finally:
    server.shutdown()


def main():
  parser = argparse.ArgumentParser(description="Run a safe load test against local or explicit staging Gewu backend.")
  parser.add_argument("--base-url", default="http://127.0.0.1:3001")
  parser.add_argument("--path", action="append", default=["/api/health"])
  parser.add_argument("--requests", type=int, default=100)
  parser.add_argument("--concurrency", type=int, default=10)
  parser.add_argument("--timeout", type=float, default=5)
  parser.add_argument("--allow-remote", action="store_true")
  parser.add_argument("--self-test", action="store_true")
  args = parser.parse_args()

  if args.self_test:
    run_self_test()
    return

  result = run_load(
    args.base_url,
    args.path,
    max(1, args.requests),
    max(1, args.concurrency),
    args.timeout,
    args.allow_remote,
  )
  print(json.dumps(result, ensure_ascii=False, indent=2))
  if result["failed"] > 0:
    raise SystemExit(1)


if __name__ == "__main__":
  main()
