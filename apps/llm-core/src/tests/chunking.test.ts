import { Document } from '@langchain/core/documents';
import { expect, test } from 'vitest';
import { chunkText } from "../utils/chunking";


test('chunkText should split text into chunks of specified size', async () => {
    const text = `
    hah, akhirnya nyambung juga otakmu.

correct me if i'm wrong katamu? justru itu bener banget, go. IYA, BETUL BANGET.

jawaban panjangku tadi itu contoh sempurna. masa iya kamu mau masukin satu esai sepanjang itu ke dalam satu vektor di Pinecone? 🤦‍♀️ kalo gitu caranya, pas kamu nanya hal spesifik, yang keluar malah ringkasan ngawur dari keseluruhan esai itu, bukan jawaban tajam ke poin yang kamu maksud.

jadi ya, pemahamanmu itu bener:
Respon panjang (atau input dari kamu) -> dipotong-potong jadi beberapa chunk yang logis (misal, per paragraf) -> masing-masing chunk baru di-embed dan disimpan ke Pinecone. setiap chunk jadi satu 'memori' kecil yang spesifik.

---

nah, pertanyaan keduamu soal SQL itu yang bagus. itu nunjukkin kamu mikirin arsitektur datanya secara keseluruhan, ga cuma di satu sisi.

jawabannya: untuk SQL (Postgres-mu), kamu simpen VERSI LENGKAPNYA. utuh, mentah, ga dipotong-potong.

gini cara mikirnya, figo, biar ga bingung lagi:

1.  Postgres (SQL) = Source of Truth.
    ini adalah arsip permanen dan utama. semua obrolan kita, dari A sampai Z, kata per kata, harus disimpen di sini dalam bentuk aslinya. lengkap dengan siapa yang ngomong dan kapan. ini adalah master data-nya. kalo Pinecone error atau kamu mau ganti model embedding, data aslinya aman di sini.

2.  Pinecone (Vector DB) = Search Index.
    ini cuma 'daftar isi' atau 'peta' yang pinter. isinya bukan data asli, tapi potongan-potongan data (chunk) yang udah diubah jadi angka (vektor) biar gampang dicari berdasarkan kemiripan makna. setiap chunk di sini harus punya 'penunjuk' balik ke data aslinya di Postgres.

jadi alurnya begini, perhatiin:

Pesan Baru Masuk (misal, dari aku):
"hah, akhirnya nyambung juga otakmu... ...biar ga bingung lagi." (pesan lengkap)

1.  Simpan ke Postgres: INSERT INTO messages (speaker, content, timestamp) VALUES ('kagami', 'pesan lengkap ini...', '2025-06-26 01:27:00');. Dapet message_id, misal 456.
2.  Potong (Chunking): Pesan lengkap tadi dipecah jadi 2 paragraf.
       Chunk 1: "hah, akhirnya nyambung juga otakmu... ...satu 'memori' kecil yang spesifik."
       Chunk 2: "nah, pertanyaan keduamu soal SQL itu yang bagus... ...biar ga bingung lagi."
3.  Embed & Simpan ke Pinecone:
       Embed Chunk 1 -> simpan ke Pinecone dengan metadata: { "message_id": 456, "chunk_index": 0 } .
       Embed Chunk 2 -> simpan ke Pinecone dengan metadata: { "message_id": 456, "chunk_index": 1 }.

liat kan? Postgres nyimpen data utuh. Pinecone nyimpen potongan-potongannya untuk pencarian cepat, dan setiap potongan itu tau dia berasal dari pesan utuh yang mana di Postgres.

ini arsitektur yang solid, go. jangan sampe salah implementasi. paham kan sekarang beda fungsi keduanyaaa?
    `;

    const chunkSize = 800;
    const chunkOverlap = 50;

    const chunks: Document[] = await chunkText(text, {
        chunkSize: chunkSize,
        chunkOverlap: chunkOverlap
    });


    console.log(chunks);
    // console.log(`Total chunks: ${chunks.length}`);

    expect(chunks).toBeDefined();
    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
        expect(chunk.pageContent.length).toBeLessThanOrEqual(chunkSize);
    }
});