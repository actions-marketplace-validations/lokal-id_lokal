// Every name, NIK, and phone number here is made up. The masked text is what @lokal-id/core produces for the
// pasted text, and the toast and tooltip strings are the extension's own (packages/extension/src/shared.ts).
export type Lang = "id" | "en";

export const COPY = {
  id: {
    hook: "Menempel data pelanggan\nke chat AI?",
    hookSub: "Lokal menyamarkannya dulu, langsung di browser.",
    steps: [
      "Tempel data pelanggan seperti biasa",
      "Data pribadi disamarkan sebelum terkirim",
      "AI tetap bisa bekerja dengan placeholder",
      "Arahkan kursor: nilai asli hanya terlihat olehmu",
      "Salin jawaban: data asli kembali",
    ],
    pasted: [
      "Tolong buatkan pesan pengingat tagihan untuk:",
      "Nama: Budi Santoso, NIK 3201011508950001, HP 0812-3456-7890",
      "Nama: Siti Rahmawati, NIK 3273024107880002, HP 0857-1122-3344",
    ],
    masked: [
      "Tolong buatkan pesan pengingat tagihan untuk:",
      "Nama: [NAME_1], NIK [NIK_1], HP [PHONE_1]",
      "Nama: [NAME_2], NIK [NIK_2], HP [PHONE_2]",
    ],
    reply: [
      "Berikut pesannya:",
      "1. Ke [PHONE_1]: Halo [NAME_1], tagihan Anda jatuh tempo besok.",
      "2. Ke [PHONE_2]: Halo [NAME_2], tagihan Anda jatuh tempo besok.",
    ],
    restored: [
      "Berikut pesannya:",
      "1. Ke 0812-3456-7890: Halo Budi Santoso, tagihan Anda jatuh tempo besok.",
      "2. Ke 0857-1122-3344: Halo Siti Rahmawati, tagihan Anda jatuh tempo besok.",
    ],
    toastMasked: "Lokal menyamarkan 2 nama, 2 NIK, 2 nomor HP sebelum dikirim.",
    toastCopied: "Disalin dengan data asli.",
    reveal: "Data asli, hanya terlihat olehmu",
    placeholder: "Tulis pesan…",
    notes: "Catatan",
    outroTitle: "Lokal untuk browser",
    outroPoints: ["ChatGPT, Claude, Gemini, dan lainnya", "Tanpa server: data asli tidak pernah keluar dari browser", "Gratis dan open source"],
    model: "Yang diterima AI",
  },
  en: {
    hook: "Pasting customer data\ninto an AI chat?",
    hookSub: "Lokal masks it first, right in your browser.",
    steps: [
      "Paste customer data as usual",
      "Personal data is masked before it is sent",
      "The AI still works with the placeholders",
      "Point at one: the real value is shown only to you",
      "Copy the answer: the real data comes back",
    ],
    pasted: [
      "Please write a payment reminder for:",
      "Name: Budi Santoso, NIK 3201011508950001, phone 0812-3456-7890",
      "Name: Siti Rahmawati, NIK 3273024107880002, phone 0857-1122-3344",
    ],
    masked: [
      "Please write a payment reminder for:",
      "Name: [NAME_1], NIK [NIK_1], phone [PHONE_1]",
      "Name: [NAME_2], NIK [NIK_2], phone [PHONE_2]",
    ],
    reply: [
      "Here are the messages:",
      "1. To [PHONE_1]: Hi [NAME_1], your bill is due tomorrow.",
      "2. To [PHONE_2]: Hi [NAME_2], your bill is due tomorrow.",
    ],
    restored: [
      "Here are the messages:",
      "1. To 0812-3456-7890: Hi Budi Santoso, your bill is due tomorrow.",
      "2. To 0857-1122-3344: Hi Siti Rahmawati, your bill is due tomorrow.",
    ],
    toastMasked: "Lokal masked 2 names, 2 NIK, 2 phone numbers before sending.",
    toastCopied: "Copied with the real values.",
    reveal: "Real value, visible only to you",
    placeholder: "Message…",
    notes: "Notes",
    outroTitle: "Lokal for the browser",
    outroPoints: ["ChatGPT, Claude, Gemini, and more", "No server: real values never leave your browser", "Free and open source"],
    model: "What the AI receives",
  },
} as const;

export const VAULT: Record<string, string> = {
  "[NAME_1]": "Budi Santoso",
  "[NAME_2]": "Siti Rahmawati",
  "[NIK_1]": "3201011508950001",
  "[NIK_2]": "3273024107880002",
  "[PHONE_1]": "0812-3456-7890",
  "[PHONE_2]": "0857-1122-3344",
};
