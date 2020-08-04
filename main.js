require("dotenv").config();
const fetch = require("node-fetch");
const FormData = require("form-data");
const path = require("path");
const fs = require("fs");
const filename = "db.json";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const chatIDS = [
    "-1001253203905",
    "-1001230449645",
]

monitor(60000);
async function monitor(delay) {
    console.log("Will monitor each " + delay + " ms");
    while(true) {
        try {
            const resText = await fetch(`https://${process.env.ST123456}:${process.env.PASSWORD}@wwwold.educ.di.unito.it/OffertaTesi/index.php`).then(r => r.text());
            const matches = resText.match(/getDoc.+?<\//g).map(plain => {
                const id = plain.match(/\d+/)[0];
                return {
                    title: plain.substr(plain.indexOf(">") + 1, plain.lastIndexOf("<") - plain.lastIndexOf(">") - 1),
                    sede: resText.substr(resText.indexOf(id)).match(/(interna)|(esterna)/i)[0],
                    url: "https://wwwold.educ.di.unito.it/OffertaTesi/getDoc.php?id=" + plain.match(/\d+/)[0],
                    id
                };
            });
            await parseMatches(matches);
        } catch(error) {
            console.error(error);
        }
        await sleep(delay);
    }
}
/**
 * @param {{sede: string, id: string, url: string, title: string}[]} entries 
 */
async function parseMatches(entries) {
    let fileExisted = fs.existsSync(filename);
    if(!fileExisted) {
        fs.writeFileSync(filename, "{}");
    }
    const filedata = JSON.parse(fs.readFileSync(filename).toString());
    for(let entry of entries) {
        if(fileExisted && filedata[entry.id] === undefined) {
            const fres = await fetch(entry.url.replace(/http(s?):\/\//, `http$1://${process.env.ST123456}:${process.env.PASSWORD}@`));
            if(!fres.ok || !fres.headers.has("content-type") === undefined) {
                throw new Error(await fres.text());
            }
            const fpath = path.resolve(__dirname, Date.now() + (fres.headers.get("content-type").match(/pdf/i) ? ".pdf" : ".txt"));
            fs.writeFileSync(fpath, await fres.buffer());
            for(let chat_ID of chatIDS) {
                await sendMultimedia("Offerta stage **" + entry.sede + "**: \n" + entry.title + "\n" + entry.url, fpath, chat_ID);
            }
        }
        filedata[entry.id] = entry;
    }
    fs.writeFileSync(filename, JSON.stringify(filedata));
}

async function sendMultimedia(message, documentFilePath, chat_ID) {
    const form = new FormData();
    form.append("caption", message);
    form.append("document", fs.createReadStream(documentFilePath));
    const res = await fetch(`https://api.telegram.org/${process.env.TG_BOT_KEY}/sendDocument?chat_id=${chat_ID}&parse_mode=markdown`, {
        method: "POST",
        body: form
    });
    if(!res.ok) {
        throw new Error(await res.text());
    }
}

