"""Download exact-version wheels (with sha256 check) into a wheelhouse. Usage: wheels.py OUTDIR PLATFORM_TAGS name==ver ..."""
import hashlib, json, os, sys, time, urllib.request
out, plats, specs = sys.argv[1], sys.argv[2].split(","), sys.argv[3:]
os.makedirs(out, exist_ok=True)
def get(url, timeout=60):
    for i in range(8):
        try:
            return urllib.request.urlopen(url, timeout=timeout).read()
        except Exception as e:
            print("retry", url, e, file=sys.stderr); time.sleep(2)
    raise SystemExit("failed " + url)
for spec in specs:
    name, ver = spec.split("==")
    meta = json.loads(get(f"https://pypi.org/pypi/{name}/{ver}/json"))
    print(name, ver, "requires:", meta["info"].get("requires_dist"), "| licence:", meta["info"].get("license_expression") or (meta["info"].get("license") or "")[:40])
    picked = []
    for f in meta["urls"]:
        fn = f["filename"]
        if not fn.endswith(".whl"): continue
        tags = fn[:-4].split("-")[-3:]
        py, abi, plat = tags
        if plat == "any" or any(p in plat for p in plats):
            if py in ("py3", "py2.py3", "cp312", "cp39", "cp310", "cp38") or py.startswith("cp3") and abi == "abi3":
                picked.append(f)
    for f in picked:
        dest = os.path.join(out, f["filename"])
        if os.path.exists(dest) and hashlib.sha256(open(dest, "rb").read()).hexdigest() == f["digests"]["sha256"]:
            continue
        data = get(f["url"], timeout=120)
        assert hashlib.sha256(data).hexdigest() == f["digests"]["sha256"], fn
        open(dest, "wb").write(data)
        print("  got", f["filename"], len(data))
