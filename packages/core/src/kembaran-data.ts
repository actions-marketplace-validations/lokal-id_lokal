// Word lists for Kembaran's stand-in values: common Indonesian given names and family names from many regions,
// street names of the kind found in every town, and harmless health complaints. Combinations are random, so a
// stand-in that happens to match a real person's name is a coincidence, not a link to them.
// python/src/lokal/_kembaran_data.py holds the same lists, in the same order.

export const MALE_FIRST: readonly string[] = [
  'Agus', 'Ahmad', 'Andi', 'Anton', 'Arif', 'Asep', 'Bagus', 'Bambang', 'Bayu', 'Benny', 'Budi', 'Cecep', 'Dadang',
  'Dani', 'Daniel', 'Dedi', 'Dimas', 'Doni', 'Edi', 'Eko', 'Fajar', 'Farhan', 'Fikri', 'Galih', 'Gede', 'Gilang',
  'Hadi', 'Hari', 'Hendra', 'Heru', 'Ilham', 'Imam', 'Indra', 'Irfan', 'Ivan', 'Iwan', 'Joko', 'Ketut', 'Kevin',
  'Komang', 'Krisna', 'Lukman', 'Made', 'Michael', 'Muhammad', 'Nyoman', 'Paulus', 'Putu', 'Rahmat', 'Rangga',
  'Reza', 'Ridwan', 'Rizki', 'Rudi', 'Satria', 'Sigit', 'Slamet', 'Steven', 'Surya', 'Taufik', 'Teguh', 'Togar',
  'Tono', 'Ujang', 'Wahyu', 'Wawan', 'Yoga', 'Yohanes', 'Yudi', 'Yusuf', 'Zainal',
];

export const FEMALE_FIRST: readonly string[] = [
  'Ana', 'Ani', 'Ayu', 'Butet', 'Citra', 'Desi', 'Dewi', 'Dian', 'Erna', 'Euis', 'Fitri', 'Fransiska', 'Grace',
  'Hana', 'Iis', 'Indah', 'Intan', 'Irma', 'Jessica', 'Kartika', 'Lina', 'Lusi', 'Maya', 'Mega', 'Nadia', 'Neng',
  'Nina', 'Novi', 'Nur', 'Nurul', 'Putri', 'Rahma', 'Ratna', 'Rina', 'Rini', 'Rosa', 'Santi', 'Sari', 'Siti', 'Sri',
  'Susi', 'Tari', 'Tuti', 'Vina', 'Widya', 'Wulan', 'Yanti', 'Yohana', 'Yuni',
];

export const MALE_LAST: readonly string[] = [
  'Damanik', 'Daulay', 'Effendi', 'Firmansyah', 'Ginting', 'Gunawan', 'Hakim', 'Halim', 'Harahap', 'Hartono',
  'Haryanto', 'Hermawan', 'Hidayat', 'Hutapea', 'Kurniawan', 'Lubis', 'Manurung', 'Matondang', 'Maulana', 'Nasution',
  'Nugroho', 'Panjaitan', 'Pane', 'Pratama', 'Prasetyo', 'Purba', 'Purnomo', 'Rahman', 'Ramadhan', 'Rangkuti',
  'Santoso', 'Saputra', 'Sembiring', 'Setiawan', 'Simanjuntak', 'Sinaga', 'Siregar', 'Sitepu', 'Sugiarto', 'Suryadi',
  'Susanto', 'Sutrisno', 'Syahputra', 'Tambunan', 'Tanjung', 'Tarigan', 'Utomo', 'Wahyudi', 'Wibowo', 'Wijaya',
];

export const FEMALE_LAST: readonly string[] = [
  'Andriani', 'Anggraini', 'Astuti', 'Damayanti', 'Fitriani', 'Ginting', 'Halim', 'Handayani', 'Hapsari', 'Harahap',
  'Kartini', 'Kusumawati', 'Lestari', 'Lubis', 'Maharani', 'Nasution', 'Ningsih', 'Novitasari', 'Oktaviani',
  'Permata', 'Pertiwi', 'Puspita', 'Purnamasari', 'Rahayu', 'Rahmawati', 'Safitri', 'Sari', 'Sinaga', 'Siregar',
  'Susanti', 'Suryani', 'Tanjung', 'Tarigan', 'Utami', 'Wahyuni', 'Wijaya', 'Wulandari', 'Yuliani',
];

export const STREETS: readonly string[] = [
  'Akasia', 'Anggrek', 'Bahagia', 'Bakti', 'Beringin', 'Cemara', 'Cempaka', 'Cendrawasih', 'Dahlia', 'Damai', 'Durian',
  'Elang', 'Flamboyan', 'Harapan', 'Jati', 'Karya', 'Kelapa', 'Kemuning', 'Kenanga', 'Kutilang', 'Mahoni', 'Mangga',
  'Melati', 'Merdeka', 'Merpati', 'Nusa Indah', 'Pahlawan', 'Pelita', 'Pemuda', 'Rajawali', 'Rambutan', 'Sejahtera',
  'Seroja', 'Swadaya', 'Teratai',
];

export const HEALTH: readonly string[] = ['Sehat', 'Flu', 'Demam', 'Batuk', 'Sakit kepala', 'Alergi ringan', 'Maag', 'Pegal linu'];

export const RELIGIONS: readonly string[] = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'];
export const MARITAL: readonly string[] = ['Belum Kawin', 'Kawin', 'Cerai Hidup', 'Cerai Mati'];

/** Honorifics and connecting words in a name that say nothing about who the person is. */
export const NAME_KEEP: ReadonlySet<string> = new Set([
  'bapak', 'bpk', 'ibu', 'bu', 'pak', 'sdr', 'sdri', 'tn', 'ny', 'nn', 'kak', 'mas', 'mbak', 'bin', 'binti', 'dr', 'drs',
  'dra', 'ir', 'h', 'hj', 'prof', 'st', 'se', 'sh', 'mm', 'skom', 'spd', 'amd',
]);
