import firebase_admin
from firebase_admin import credentials, firestore
import csv

cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

productos = db.collection("productos").stream()

with open("imagenes.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["sku", "imagen"])

    for p in productos:
        data = p.to_dict()

        sku = data.get("sku", "")
        nombre = data.get("nombre", "")

        url = f"https://source.unsplash.com/400x400/?{nombre.replace(' ', ',')}"

        writer.writerow([sku, url])

print("CSV generado")