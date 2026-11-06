"""Cyberbullying detection API: serves the model selected in the notebook + MongoDB statistics."""
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pymongo import MongoClient

from text_utils import clean_text

BASE = Path(os.getenv("APP_HOME", Path(__file__).resolve().parent.parent))
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB, COLLECTION = "cyberbullying", "messages"
state: dict = {}


def seed_mongo():
    """Load the cleaned dataset into MongoDB if the collection is empty (fresh deployment)."""
    try:
        col = state["mongo"][DB][COLLECTION]
        if col.estimated_document_count() == 0:
            col.insert_many(pd.read_csv(BASE / "data" / "clean_cyberbullying.csv").to_dict("records"))
    except Exception as e:
        print(f"MongoDB seeding skipped: {e}")


@asynccontextmanager
async def lifespan(_: FastAPI):
    state["model"] = joblib.load(BASE / "models" / "best_model.joblib")
    vec, clf = state["model"].named_steps["tfidf"], state["model"].named_steps["clf"]
    state["vocab"] = vec.get_feature_names_out()
    # Naive Bayes: how much each word/bigram pushes towards "Bullying" (log-odds)
    state["word_weight"] = clf.feature_log_prob_[1] - clf.feature_log_prob_[0]
    state["meta"] = json.loads((BASE / "models" / "metadata.json").read_text())
    state["mongo"] = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    seed_mongo()
    yield
    state["mongo"].close()


app = FastAPI(title="Cyberbullying Detection API", version="1.0.0", lifespan=lifespan)

# ---- Web dashboard (HTML/CSS/JS served by FastAPI) ----
STATIC = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")



class Message(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, examples=["you are so stupid nobody likes you"])


class Batch(BaseModel):
    texts: list[str] = Field(..., min_length=1, max_length=1000)


class Prediction(BaseModel):
    text: str
    label: str
    is_bullying: bool
    probability_bullying: float
    key_words: list[str] = []


def key_words(clean_texts: list[str], top: int = 3) -> list[list[str]]:
    """Words of each message that pushed the model most towards 'Bullying'."""
    X = state["model"].named_steps["tfidf"].transform(clean_texts)
    out = []
    for i in range(X.shape[0]):
        row = X.getrow(i)
        scores = row.data * state["word_weight"][row.indices]
        best = [row.indices[j] for j in np.argsort(scores)[::-1][:top] if scores[j] > 0]
        out.append([str(state["vocab"][k]) for k in best])
    return out


def predict_texts(texts: list[str]) -> list[Prediction]:
    cleaned = [clean_text(t) for t in texts]
    probs = state["model"].predict_proba(cleaned)[:, 1]
    thr = state["meta"]["threshold"]
    preds = [Prediction(text=t, label="Bullying" if p >= thr else "Not-Bullying",
                        is_bullying=bool(p >= thr), probability_bullying=round(float(p), 4),
                        key_words=kw if p >= thr else [])
             for t, p, kw in zip(texts, probs, key_words(cleaned))]
    try:  # log predictions for monitoring; never fail the request because of it
        state["mongo"][DB]["predictions"].insert_many(
            [{**p.model_dump(), "at": datetime.now(timezone.utc)} for p in preds])
    except Exception:
        pass
    return preds


@app.get("/", include_in_schema=False)
def home():
    """Simple web page for non-technical users."""
    return FileResponse(STATIC / "index.html")


@app.get("/health")
def health():
    try:
        state["mongo"].admin.command("ping")
        mongo = "up"
    except Exception:
        mongo = "down"
    return {"status": "ok", "model": state["meta"]["best_model"], "mongo": mongo}


@app.get("/model")
def model_info():
    return state["meta"]


@app.post("/predict", response_model=Prediction)
def predict(msg: Message):
    return predict_texts([msg.text])[0]


@app.post("/predict/batch", response_model=list[Prediction])
def predict_batch(batch: Batch):
    return predict_texts(batch.texts)


@app.get("/stats")
def stats():
    try:
        col = state["mongo"][DB][COLLECTION]
        if col.estimated_document_count() == 0:  # DB was unreachable at startup -> seed now
            seed_mongo()
        by_label = {r["_id"]: r["n"] for r in col.aggregate([{"$group": {"_id": "$label_name", "n": {"$sum": 1}}}])}
        by_type = list(col.aggregate([
            {"$match": {"label": 1}},
            {"$group": {"_id": "$type", "n": {"$sum": 1}, "avg_words": {"$avg": "$word_count"}}},
            {"$sort": {"n": -1}}]))
    except Exception as e:
        raise HTTPException(503, f"MongoDB unavailable: {e}")
    return {"total": sum(by_label.values()), "by_label": by_label,
            "bullying_by_type": [{"type": r["_id"], "count": r["n"], "avg_words": round(r["avg_words"], 1)}
                                 for r in by_type]}
