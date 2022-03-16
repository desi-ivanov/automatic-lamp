import * as functions from "firebase-functions";
import fetch from "node-fetch";
import * as FormData from "form-data";
import { firestore, initializeApp } from "firebase-admin";
import * as crypto from "crypto";

type Entry = {
  title: string;
  sede: string | null;
  url: string;
  id: string;
}

const { unito, tg } = functions.config();

if(!unito.st123456 || !unito.password || !tg.tg_bot_key) {
  throw new Error("Missing environment variables");
}

initializeApp();

const chatIDS = ["-1001253203905"];
const toBase64 = (s: string): string => Buffer.from(s).toString("base64");
const basicAuth = (user: string, pass: string) => "Basic " + toBase64(user + ":" + pass);
const authFetch = (url: string) => fetch(url, { headers: { Authorization: basicAuth(unito.st123456, unito.password) } });

export const check = functions.pubsub.schedule("every minute").onRun(async () => {
  try {
    const res = await authFetch("https://wwwold.educ.di.unito.it/OffertaTesi/index.php");
    if(!res.ok) {
      throw new Error("Error while fetching: " + res.statusText + ". Status: " + res.status);
    }
    const resText = await res.text();
    const matches: Entry[] = (resText.match(/getDoc.+?<\//g) ?? [])
      .map((plain) => [plain, plain.match(/\d+/)?.[0]] as [string, string | undefined])
      .filter((x): x is [string, string] => x[1] !== undefined)
      .map(([plain, id]) => ({
        title: plain.match(/>.+?</)?.[0].slice(1, -1) ?? "",
        sede: resText.substring(resText.indexOf(id)).match(/(interna)|(esterna)/i)?.[0] ?? null,
        url: "https://wwwold.educ.di.unito.it/OffertaTesi/getDoc.php?id=" + id,
        id,
      }));
    await sendUnseen(matches);
  } catch(error) {
    console.error(error);
  }
});

async function sendUnseen(entries: Entry[]) {
  const all = firestore().collection("offerte_stage").doc("all");
  const memo = ((await all.get()).data() ?? { ids: entries.map((e) => e.id) }) as { ids: string[] };
  for(const entry of entries) {
    try {
      if(!memo.ids.includes(entry.id)) {
        const { sha256 } = await sendEntry(entry);
        await firestore().collection("offerte_stage").doc(entry.id).set({ ...entry, sha256 });
        memo.ids.push(entry.id);
      }
    } catch(err) {
      console.error(err);
    }
  }
  all.set(memo);
}

async function sendEntry(entry: Entry): Promise<{ sha256: string }> {
  const entryDocument = await authFetch(entry.url);
  if(!entryDocument.ok || !entryDocument.headers.has("content-type")) {
    throw new Error(await entryDocument.text());
  }
  const buffer = await entryDocument.buffer();
  for(const chatId of chatIDS) {
    await sendMultimedia(
      "Offerta stage **" + entry.sede + "**: \n" + entry.title + "\n" + entry.url,
      buffer,
      Date.now() + (entryDocument.headers.get("content-type")?.match(/pdf/i) ? ".pdf" : ".txt"),
      chatId,
    );
  }
  return {
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

async function sendMultimedia(message: string, document: Buffer, filename: string, chatId: string) {
  const form = new FormData();
  form.append("caption", message);
  form.append("document", document, { filename });
  const res = await fetch(`https://api.telegram.org/${tg.tg_bot_key}/sendDocument?chat_id=${chatId}&parse_mode=markdown`, { method: "POST", body: form });
  if(!res.ok) {
    throw new Error(await res.text());
  }
}

