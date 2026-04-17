import csv
import requests
import time
import firebase_admin
from firebase_admin import credentials, firestore

# CONFIG
CLOUD_NAME = "df4qmhp7i"
UPLOAD_PRESET = "armhel_unsigned"

cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

def upload(image_url, sku):
    url = f"https://api.cloudinary.com/v1_1/{CLOUD_NAME}/image/upload"
    
    data = {
        "file": image_url,
        "upload_preset": UPLOAD_PRESET,
        "public_id": sku
    }

    res = requests.post(url, data=data)
    return res.json()

def update(sku, url):
    docs = db.collection("productos").where("sku", "==", sku).stream()
    for doc in docs:
        doc.reference.update({"imagen": url})

with open("imagenes.csv", newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)

    for i, row in enumerate(reader):
        sku = row["sku"]
        img = row["imagen"]

        try:
            print(f"{i} - Subiendo {sku}")

            r = upload(img, sku)

            if "secure_url" in r:
                update(sku, r["secure_url"])
                print("OK")
            else:
                print("ERROR:", r)

            time.sleep(0.3)

        except Exception as e:
            print("FALLO:", sku, e)