// Common Indonesian given and family names, to recognize a person's name in free text that has no cue around it:
// "Pelanggan Budi Santoso minta refund", "transfer u/ Wahyu Hidayat", "BI-FAST CR SITI RAHAYU 75000.00".
// Lists of common names, not of people.

/** Given names that are rarely anything else. Enough on their own before another capitalized word. */
export const GIVEN_NAMES = new Set(
  (
    // Male
    'agus ahmad akhmad achmad abdul abdur firman adi aditya adit andi andika anton ari arief arif aris bambang benny budiman cahyo ' +
    'dedi deni denny dimas dodi doni edi edy eko erwin fajri fauzi fauzan ferry fikri gilang hadi hafiz haris hasan ' +
    'hendra hendro heru ibnu ilham indra iqbal irfan irwan iwan joko jefri kevin krisna lukman lutfi mahmud muhammad ' +
    'mohammad mochammad muhamad mohamad moh mukhlis nanang oki rahmat rachmat reza ridwan rizal rizky rizki ' +
    'rudi rudy ryan sandi setyo sigit slamet sugeng suryadi syahrul taufik teguh toni tono totok wawan yanto yogi ' +
    'yusuf zainal arya bayu rangga dendi galih hanif hilman habibi jamal kholil nurdin roni rony sahrul samsul ' +
    'sapto sofyan sukarno supardi suparman sutrisno syaiful saiful tatang ujang usman wahyudi yudi yuda zaki ' +
    'antonius yohanes johannes petrus paulus stefanus fransiskus agustinus yosef daniel samuel michael ' +
    // Female
    'siti rina rini ratna ratih yuni yulia yuliana nurul nining ani anisa annisa aisyah aminah fitri fitria ' +
    'lina lia maya mira nia novi novita nanda nadia nabila rahma ria rika risa rosa sinta shinta susi susan tuti ' +
    'umi widya yanti yati eva evi erna endah diah dyah desi devi dina dini fatimah hana ika irma lilis linda lusi ' +
    'marlina mariam maryam nina nisa novia rosita salsabila tika titin winda yeni zahra farah dewanti ernawati ' +
    'kartini juwita yohana theresia veronika elisabeth kristina maria agnes ningsih ' +
    'sumarni suminah sulastri sundari suparmi tumini warsini ' +
    'asep dadang cecep encep iis euis yayan aep jajang ayi engkos entis odah otong ruslan nunung yeyen ' +
    'yuyun dedeh enok popon dede paijo parman paimin sumarno sukirman sukinah tukiman tukinem wagiman ' +
    'wagiyem painem ngatini ngadimin sutarno sutini sriyati suyatno suyanti subagyo sugiono supriyadi ' +
    'supriyanto susilowati sutopo sutejo jaka danang endang moch abdurrahman husein husin hasanudin ' +
    'hamzah ibrahim ismail yunus musa harun ikhsan ihsan faisal fahmi farhan farid husni ilyas jamil ' +
    'karim khoirul luqman malik mansur munir mustofa nasrul nurhayati nuraini nurlela khadijah zainab ' +
    'halimah hafsah salma syifa naila najwa aulia azizah khairunnisa laila latifah yoseph markus lukas ' +
    'matius benediktus kristian christina christine magdalena natalia natalie clarissa claudia cindy ' +
    'jessica jesica michelle stella vania angelina felicia patricia monica gabriella evelyn vivian steven ' +
    'stevan david jonathan nathan william felix ivan albert alvin andreas hendrik robert richard vincent ' +
    'edwin edward jeffry ricky rico hengky hendry rani riska rizka rifki rafi rafa puspita candra arie ' +
    'dani dicky dony erik fadil johan rendra rian riyan septian tomi wisnu yadi yudha anita bella della ' +
    'dita elsa ema fani fenny fira henny lisa reni resti rita siska sofi tiwi vera vina wina yani yuli ' +
    'tina ira cantika'
  ).split(' '),
);

/** Given names that are also common words ("budi pekerti", "indah sekali", "fajar menyingsing"). Need a second name. */
export const AMBIGUOUS_GIVEN_NAMES = new Set(
  (
    'budi sri sekar laras murni indah putri putra ayu fajar agung mega intan sari dewi wahyu citra cahya kartika permata bunga suci ' +
    'wulan melati puspa lestari surya eka dwi tri catur imam hari kurnia nur bintang rizqi rezeki mulia setia ' +
    'cinta kasih bagus santi sinar rahayu dian ratu asih mawar mutiara panca bima satria pandu panji puji tari gita okta octa vino yoga angel grace nana ana ida ina sudirman rejeki wati'
  ).split(' '),
);

/** Family names and common second names, including Batak, Karo, Minahasa, and Maluku clan names. */
export const FAMILY_NAMES = new Set(
  (
    'utomo widodo santoso susanto wijaya widjaja saputra saputri pratama pratiwi hidayat hidayah setiawan setiadi kurniawan ' +
    'kurniawati gunawan hartono sutanto suharto susilo wibowo prasetyo prasetya nugraha nugroho purnomo permana ' +
    'ramadhan ramadhani firmansyah hakim rahman rahmawati wahyudi wahyuni handayani ' +
    'kusumawati maharani safitri anggraini puspitasari novitasari wulandari sulistyowati sukmawati suryani ' +
    'haryanto budiman irawan sanjaya tanoto salim suryadi siswanto effendi effendy syahputra sutrisno ' +
    'mulyadi mulyani haryadi sudarsono suryanto purwanto sugiarto sugianto kristanto tjandra chandra hermawan ' +
    'hendrawan darmawan dharmawan ardiansyah pangestu yulianti fitriani oktaviani septiani ramadani hidayatullah ' +
    'abdullah rosadi sopian sofyan iskandar sitorus ' +
    // Batak and Karo
    'nasution harahap lubis siregar simanjuntak simatupang sitompul hutapea pardede panjaitan situmorang sinaga ' +
    'tambunan manurung sihombing simbolon hutagalung napitupulu silalahi pasaribu sembiring ginting tarigan purba ' +
    'saragih damanik hasibuan batubara daulay pohan rangkuti ritonga matondang gultom sianturi simamora marpaung ' +
    'aritonang hutabarat pakpahan sibarani sirait samosir sidabutar munthe sinambela nainggolan manullang siahaan ' +
    'simanungkalit rajagukguk lumbantobing butarbutar sinurat girsang perangin-angin peranginangin ' +
    // Minahasa and Maluku
    'sumampouw pangemanan wenas lumentut rondonuwu mandagi tumbelaka tuhumury latuconsina pattinama wattimena ' +
    'pattiasina lewerissa'
  ).split(' '),
);

/**
 * Second names that also end place names ("Mekar Sari", "Sido Rahayu", "Way Halim"). They count only after a given
 * name: "Dewi Lestari", "Siti Rahayu".
 */
export const SECOND_NAMES = new Set(
  'sari rahayu lestari wati yanti ningsih ningrum astuti utami kusuma halim aminah kartika'.split(' '),
);

/** Chinese-Indonesian family names that start a three-part name: "Lim Swie Hong", "Tan Mei Ling". */
export const CHINESE_FAMILY_NAMES = new Set(
  'lim liem tan tjan ong oei wong kwee gouw khoe tjoa thio tio liauw chen ng yap teo kho sie tjia lauw liong'.split(' '),
);

/** Balinese birth-order and caste names after "I" or "Ni": "I Made Wirawan", "Ni Luh Putu Ayu". */
export const BALINESE_NAMES = new Set('made wayan nyoman ketut gede putu kadek komang nengah luh gusti dewa'.split(' '));
