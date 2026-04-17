import urllib.request
import urllib.parse
import urllib.error
import json
import time
import re

FIREBASE_PROJECT = "armhel-ferreteria"
FIREBASE_API_KEY = "AIzaSyBSxak7iBUY0agyeP9yCoalpYeIbkfZ3EE"

FIREBASE_EMAIL = input("Email Firebase Admin: ")
FIREBASE_PASS  = input("Contraseña Firebase: ")

def firebase_req(url, data=None, method="GET", token=None):
    headers = {"Content-Type": "application/json"}
    if token: headers["Authorization"] = "Bearer " + token
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

def get_token():
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}"
    res = firebase_req(url, {"email": FIREBASE_EMAIL, "password": FIREBASE_PASS, "returnSecureToken": True}, "POST")
    if "idToken" in res:
        print("✅ Sesión Firebase iniciada")
        return res["idToken"]
    print("❌ Error:", res)
    return None

def get_all_prods(token):
    todos = []
    page_token = None
    while True:
        url = f"https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT}/databases/(default)/documents/productos?pageSize=300"
        if page_token: url += f"&pageToken={page_token}"
        res = firebase_req(url, token=token)
        docs = res.get("documents", [])
        todos.extend(docs)
        page_token = res.get("nextPageToken")
        print(f"  Cargados {len(todos)}...")
        if not page_token: break
        time.sleep(0.2)
    return todos

def get_foto_duckduckgo(nombre):
    """Busca imagen en DuckDuckGo usando el nombre del producto"""
    # Limpiar nombre para búsqueda
    query = nombre[:80]  # Max 80 chars
    query_enc = urllib.parse.quote(query)
    
    # DuckDuckGo image search
    url = f"https://duckduckgo.com/?q={query_enc}&iax=images&ia=images&format=json"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "es-UY,es;q=0.9",
        "Referer": "https://duckduckgo.com/"
    }
    
    # Primero obtener token de DuckDuckGo
    try:
        req = urllib.request.Request(
            f"https://duckduckgo.com/?q={query_enc}&iax=images&ia=images",
            headers=headers
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            html = r.read().decode('utf-8', errors='ignore')
            vqd = re.search(r'vqd=([\d-]+)', html)
            if not vqd:
                return None
            vqd_val = vqd.group(1)
    except:
        return None

    # Buscar imágenes con el token
    try:
        img_url = f"https://duckduckgo.com/i.js?q={query_enc}&vqd={vqd_val}&p=1"
        req2 = urllib.request.Request(img_url, headers={
            **headers,
            "Accept": "application/json",
            "Referer": f"https://duckduckgo.com/?q={query_enc}&iax=images&ia=images"
        })
        with urllib.request.urlopen(req2, timeout=10) as r2:
            data = json.loads(r2.read())
            results = data.get("results", [])
            for result in results[:3]:
                img = result.get("image", "")
                # Preferir imágenes jpg/webp/png y evitar logos o iconos pequeños
                if img and any(ext in img.lower() for ext in ['.jpg','.jpeg','.webp','.png']):
                    width = result.get("width", 0)
                    height = result.get("height", 0)
                    # Solo imágenes de tamaño razonable
                    if width >= 200 and height >= 200:
                        return img
    except:
        pass
    return None

def update_foto(doc_name, foto_url, token):
    url = f"https://firestore.googleapis.com/v1/{doc_name}?updateMask.fieldPaths=foto"
    data = {"fields": {"foto": {"stringValue": foto_url}}}
    firebase_req(url, data, "PATCH", token)

def main():
    token = get_token()
    if not token: return

    print("\n📥 Leyendo productos de Firebase...")
    docs = get_all_prods(token)
    print(f"✅ {len(docs)} productos")

    sin_foto = []
    for d in docs:
        fields = d.get("fields", {})
        foto = fields.get("foto", {}).get("stringValue", "")
        nombre = fields.get("nombre", {}).get("stringValue", "")
        item_id = fields.get("item_id", {}).get("stringValue", "")
        if not foto and nombre:
            sin_foto.append({"name": d["name"], "nombre": nombre, "item_id": item_id})

    print(f"\n🧪 Probando DuckDuckGo con los primeros 5 productos...")
    exitos = 0
    for p in sin_foto[:5]:
        url = get_foto_duckduckgo(p["nombre"])
        estado = f"✓ {url[:70]}..." if url else "✗ no encontrado"
        print(f"  {p['nombre'][:50]} → {estado}")
        if url: exitos += 1
        time.sleep(1.5)

    if exitos == 0:
        print("\n❌ DuckDuckGo también bloqueó las requests.")
        print("💡 Instalá requests con: pip install requests")
        print("   Y avisame para generar una versión con requests que funciona mejor.")
        return

    seguir = input(f"\n✓ {exitos}/5 encontradas. ¿Continuar con todos? (s/n): ")
    if seguir.lower() != 's':
        print("Cancelado.")
        return

    print(f"\n📸 Procesando {len(sin_foto)} productos...\n")
    ok = 0
    fail = 0
    total = len(sin_foto)

    for i, p in enumerate(sin_foto):
        foto_url = get_foto_duckduckgo(p["nombre"])
        if foto_url:
            update_foto(p["name"], foto_url, token)
            ok += 1
            if ok <= 5 or ok % 200 == 0:
                print(f"  ✓ [{p['nombre'][:40]}] foto guardada")
        else:
            fail += 1

        if (i+1) % 100 == 0:
            pct = round((i+1)/total*100)
            print(f"  📊 {i+1}/{total} ({pct}%) — ✓ {ok} / ✗ {fail}")

        time.sleep(1.5)  # respetar rate limit DDG

    print(f"\n🎉 Listo! {ok} fotos / {fail} sin foto")

if __name__ == "__main__":
    main()
