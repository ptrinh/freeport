/**
 * Curated Country → State/Province → City data for the Location picker.
 *
 * Covers the full union of Uber/Grab/Bolt/inDrive markets (present + past).
 * The picked country drives the default payment currency — each country uses
 * its real, most-mainstream currency (ISO 4217), formatted via Intl.
 */
import { getI18nLang } from './i18n';

/** ISO 4217 alpha-3 currency code (e.g. 'VND', 'USD', 'EUR'). */
export type Currency = string;

export interface CountryData {
  code: string;          // ISO 3166-1 alpha-2
  name: string;
  /** Address depth: 1 = country only (Singapore), 2 = country→state (most),
   *  3 = country→state→city (large countries like the US). */
  levels: 1 | 2 | 3;
  states: Record<string, string[]>; // state/province → cities
}

/**
 * Country (ISO 3166-1 alpha-2) → most-mainstream currency (ISO 4217).
 * Where a country officially uses the US dollar or another anchor in daily
 * commerce, that is reflected (e.g. PA/EC/SV/TL/ZW → USD).
 */
const COUNTRY_CURRENCY: Record<string, Currency> = {
  VN: 'VND', SG: 'SGD', TH: 'THB', MY: 'MYR', ID: 'IDR', PH: 'PHP', US: 'USD',
  MM: 'MMK', KH: 'KHR', BN: 'BND', LA: 'LAK', TL: 'USD',
  IN: 'INR', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR',
  HK: 'HKD', MO: 'MOP', TW: 'TWD', JP: 'JPY', KR: 'KRW', CN: 'CNY',
  AU: 'AUD', NZ: 'NZD',
  KZ: 'KZT', UZ: 'UZS', KG: 'KGS', TJ: 'TJS', GE: 'GEL', AZ: 'AZN', AM: 'AMD',
  RU: 'RUB', UA: 'UAH', BY: 'BYN', MD: 'MDL',
  GB: 'GBP', IE: 'EUR', FR: 'EUR', DE: 'EUR', NL: 'EUR', BE: 'EUR', LU: 'EUR', CH: 'CHF',
  AT: 'EUR', SE: 'SEK', FI: 'EUR', NO: 'NOK', DK: 'DKK',
  ES: 'EUR', PT: 'EUR', IT: 'EUR', GR: 'EUR', MT: 'EUR', CY: 'EUR',
  PL: 'PLN', CZ: 'CZK', SK: 'EUR', HU: 'HUF', RO: 'RON', BG: 'BGN',
  HR: 'EUR', SI: 'EUR', RS: 'RSD', BA: 'BAM', ME: 'EUR', MK: 'MKD', AL: 'ALL',
  EE: 'EUR', LV: 'EUR', LT: 'EUR',
  TR: 'TRY', AE: 'AED', SA: 'SAR', QA: 'QAR', BH: 'BHD', KW: 'KWD', OM: 'OMR',
  JO: 'JOD', LB: 'LBP', IQ: 'IQD', IL: 'ILS',
  EG: 'EGP', MA: 'MAD', TN: 'TND', DZ: 'DZD',
  NG: 'NGN', ZA: 'ZAR', KE: 'KES', GH: 'GHS', TZ: 'TZS', UG: 'UGX',
  CI: 'XOF', SN: 'XOF', CM: 'XAF', ET: 'ETB', MZ: 'MZN', ZM: 'ZMW', AO: 'AOA',
  ZW: 'USD', RW: 'RWF', CD: 'CDF', NA: 'NAD', BW: 'BWP',
  CA: 'CAD', MX: 'MXN', GT: 'GTQ', SV: 'USD', HN: 'HNL', NI: 'NIO', CR: 'CRC',
  PA: 'USD', DO: 'DOP', PR: 'USD', TT: 'TTD',
  BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', EC: 'USD', BO: 'BOB',
  PY: 'PYG', UY: 'UYU', VE: 'VES',
};

/** Compact states map from a list of major cities (no sub-city level). */
const ms = (...names: string[]): Record<string, string[]> =>
  Object.fromEntries(names.map((n) => [n, []]));

export const COUNTRIES: CountryData[] = [
  {
    code: 'VN',
    name: 'Vietnam',
    levels: 2,
    states: {
      'Hồ Chí Minh': ['Quận 1', 'Quận 3', 'Quận 5', 'Quận 7', 'Bình Thạnh', 'Phú Nhuận', 'Thủ Đức', 'Gò Vấp', 'Tân Bình'],
      'Hà Nội': ['Hoàn Kiếm', 'Ba Đình', 'Đống Đa', 'Cầu Giấy', 'Hai Bà Trưng', 'Tây Hồ', 'Long Biên', 'Hà Đông'],
      'Đà Nẵng': ['Hải Châu', 'Thanh Khê', 'Sơn Trà', 'Ngũ Hành Sơn', 'Liên Chiểu'],
      'Hải Phòng': ['Hồng Bàng', 'Lê Chân', 'Ngô Quyền', 'Hải An'],
      'Cần Thơ': ['Ninh Kiều', 'Bình Thủy', 'Cái Răng'],
      'Bình Dương': ['Thủ Dầu Một', 'Dĩ An', 'Thuận An'],
      'Đồng Nai': ['Biên Hòa', 'Long Khánh'],
      'Khánh Hòa': ['Nha Trang', 'Cam Ranh'],
      'Lâm Đồng': ['Đà Lạt', 'Bảo Lộc'],
      'Quảng Ninh': ['Hạ Long', 'Cẩm Phả', 'Móng Cái'],
      'Thừa Thiên Huế': ['Huế'],
      'Bà Rịa – Vũng Tàu': ['Vũng Tàu', 'Bà Rịa'],
    },
  },
  {
    code: 'SG',
    name: 'Singapore',
    levels: 1,
    states: {
      Central: ['Orchard', 'Newton', 'Bukit Timah', 'Toa Payoh', 'Bishan', 'Marina'],
      East: ['Bedok', 'Tampines', 'Pasir Ris', 'Changi', 'Katong'],
      'North-East': ['Hougang', 'Sengkang', 'Punggol', 'Serangoon', 'Ang Mo Kio'],
      North: ['Woodlands', 'Yishun', 'Sembawang'],
      West: ['Jurong East', 'Jurong West', 'Clementi', 'Bukit Batok', 'Choa Chu Kang'],
    },
  },
  {
    code: 'TH',
    name: 'Thailand',
    levels: 2,
    states: {
      Bangkok: ['Sukhumvit', 'Silom', 'Sathorn', 'Chatuchak'],
      'Chiang Mai': ['Mueang Chiang Mai', 'Hang Dong'],
      Phuket: ['Mueang Phuket', 'Patong'],
      'Chon Buri': ['Pattaya', 'Si Racha'],
    },
  },
  {
    code: 'MY',
    name: 'Malaysia',
    levels: 2,
    states: {
      'Kuala Lumpur': ['Bukit Bintang', 'Cheras', 'Kepong', 'Setapak'],
      Selangor: ['Petaling Jaya', 'Shah Alam', 'Subang Jaya', 'Klang'],
      Penang: ['George Town', 'Bayan Lepas'],
      Johor: ['Johor Bahru', 'Iskandar Puteri'],
    },
  },
  {
    code: 'ID',
    name: 'Indonesia',
    levels: 2,
    states: {
      Jakarta: ['Central Jakarta', 'South Jakarta', 'West Jakarta'],
      'West Java': ['Bandung', 'Bekasi', 'Depok'],
      Bali: ['Denpasar', 'Kuta', 'Ubud'],
    },
  },
  {
    code: 'PH',
    name: 'Philippines',
    levels: 2,
    states: {
      'Metro Manila': ['Makati', 'Quezon City', 'Taguig', 'Pasig'],
      Cebu: ['Cebu City', 'Mandaue'],
      Davao: ['Davao City'],
    },
  },
  {
    code: 'US',
    name: 'United States',
    levels: 3,
    states: {
      Alabama: ['Birmingham', 'Montgomery', 'Huntsville', 'Mobile'],
      Alaska: ['Anchorage', 'Fairbanks', 'Juneau'],
      Arizona: ['Phoenix', 'Tucson', 'Mesa', 'Scottsdale', 'Tempe'],
      Arkansas: ['Little Rock', 'Fayetteville', 'Fort Smith'],
      California: ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Oakland', 'Fresno', 'Long Beach'],
      Colorado: ['Denver', 'Colorado Springs', 'Aurora', 'Boulder'],
      Connecticut: ['Bridgeport', 'New Haven', 'Hartford', 'Stamford'],
      Delaware: ['Wilmington', 'Dover', 'Newark'],
      'District of Columbia': ['Washington'],
      Florida: ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'Tallahassee', 'St. Petersburg'],
      Georgia: ['Atlanta', 'Savannah', 'Augusta', 'Columbus', 'Athens'],
      Hawaii: ['Honolulu', 'Hilo', 'Kailua'],
      Idaho: ['Boise', 'Meridian', 'Nampa'],
      Illinois: ['Chicago', 'Aurora', 'Naperville', 'Springfield'],
      Indiana: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend'],
      Iowa: ['Des Moines', 'Cedar Rapids', 'Davenport'],
      Kansas: ['Wichita', 'Overland Park', 'Kansas City', 'Topeka'],
      Kentucky: ['Louisville', 'Lexington', 'Bowling Green'],
      Louisiana: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette'],
      Maine: ['Portland', 'Lewiston', 'Bangor'],
      Maryland: ['Baltimore', 'Columbia', 'Annapolis', 'Silver Spring'],
      Massachusetts: ['Boston', 'Worcester', 'Springfield', 'Cambridge'],
      Michigan: ['Detroit', 'Grand Rapids', 'Ann Arbor', 'Lansing'],
      Minnesota: ['Minneapolis', 'Saint Paul', 'Rochester', 'Duluth'],
      Mississippi: ['Jackson', 'Gulfport', 'Biloxi'],
      Missouri: ['Kansas City', 'St. Louis', 'Springfield', 'Columbia'],
      Montana: ['Billings', 'Missoula', 'Bozeman', 'Helena'],
      Nebraska: ['Omaha', 'Lincoln', 'Bellevue'],
      Nevada: ['Las Vegas', 'Henderson', 'Reno', 'Carson City'],
      'New Hampshire': ['Manchester', 'Nashua', 'Concord'],
      'New Jersey': ['Newark', 'Jersey City', 'Trenton', 'Atlantic City'],
      'New Mexico': ['Albuquerque', 'Santa Fe', 'Las Cruces'],
      // Nassau + Suffolk counties (Long Island) added on a user request from NYC-LI.
      'New York': ['New York City', 'Buffalo', 'Rochester', 'Albany', 'Syracuse', 'Yonkers', 'Nassau County', 'Suffolk County'],
      'North Carolina': ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem'],
      'North Dakota': ['Fargo', 'Bismarck', 'Grand Forks'],
      Ohio: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron'],
      Oklahoma: ['Oklahoma City', 'Tulsa', 'Norman'],
      Oregon: ['Portland', 'Salem', 'Eugene', 'Bend'],
      Pennsylvania: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Harrisburg'],
      'Rhode Island': ['Providence', 'Warwick', 'Newport'],
      'South Carolina': ['Charleston', 'Columbia', 'Greenville', 'Myrtle Beach'],
      'South Dakota': ['Sioux Falls', 'Rapid City', 'Pierre'],
      Tennessee: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga'],
      Texas: ['Houston', 'Austin', 'Dallas', 'San Antonio', 'Fort Worth', 'El Paso'],
      Utah: ['Salt Lake City', 'Provo', 'Park City', 'Ogden'],
      Vermont: ['Burlington', 'Montpelier', 'Rutland'],
      Virginia: ['Virginia Beach', 'Richmond', 'Arlington', 'Norfolk', 'Alexandria'],
      Washington: ['Seattle', 'Bellevue', 'Tacoma', 'Spokane', 'Vancouver'],
      'West Virginia': ['Charleston', 'Huntington', 'Morgantown'],
      Wisconsin: ['Milwaukee', 'Madison', 'Green Bay'],
      Wyoming: ['Cheyenne', 'Casper', 'Jackson'],
    },
  },

  // ── The rest of the list covers everywhere Uber / Grab / Bolt / inDrive
  //    operate today or operated in the past. Each country's currency comes
  //    from COUNTRY_CURRENCY above; major cities serve as State/Province options.

  // Southeast Asia (Grab, Uber-past, inDrive, Gojek)
  { code: 'MM', name: 'Myanmar', levels: 2, states: ms('Yangon', 'Mandalay', 'Naypyidaw') },
  { code: 'KH', name: 'Cambodia', levels: 2, states: ms('Phnom Penh', 'Siem Reap', 'Battambang', 'Sihanoukville') },
  { code: 'BN', name: 'Brunei', levels: 2, states: ms('Bandar Seri Begawan') },
  { code: 'LA', name: 'Laos', levels: 2, states: ms('Vientiane', 'Luang Prabang') },
  { code: 'TL', name: 'Timor-Leste', levels: 2, states: ms('Dili') },

  // South Asia (Uber, inDrive, Bolt)
  { code: 'IN', name: 'India', levels: 2, states: ms('Delhi', 'Mumbai', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur') },
  { code: 'PK', name: 'Pakistan', levels: 2, states: ms('Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Peshawar') },
  { code: 'BD', name: 'Bangladesh', levels: 2, states: ms('Dhaka', 'Chattogram', 'Sylhet', 'Khulna') },
  { code: 'LK', name: 'Sri Lanka', levels: 2, states: ms('Colombo', 'Kandy', 'Galle', 'Jaffna') },
  { code: 'NP', name: 'Nepal', levels: 2, states: ms('Kathmandu', 'Pokhara', 'Lalitpur') },

  // East Asia (Uber present + past, Didi)
  { code: 'HK', name: 'Hong Kong', levels: 2, states: ms('Hong Kong Island', 'Kowloon', 'New Territories') },
  { code: 'MO', name: 'Macau', levels: 2, states: ms('Macau Peninsula', 'Taipa', 'Cotai') },
  { code: 'TW', name: 'Taiwan', levels: 2, states: ms('Taipei', 'New Taipei', 'Kaohsiung', 'Taichung', 'Tainan', 'Taoyuan') },
  { code: 'JP', name: 'Japan', levels: 2, states: ms('Tokyo', 'Osaka', 'Kyoto', 'Nagoya', 'Yokohama', 'Fukuoka', 'Sapporo') },
  { code: 'KR', name: 'South Korea', levels: 2, states: ms('Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon') },
  { code: 'CN', name: 'China', levels: 2, states: ms('Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu', 'Hangzhou', 'Wuhan', "Xi'an") },

  // Oceania (Uber, Bolt-trial, DiDi, Ola)
  { code: 'AU', name: 'Australia', levels: 2, states: ms('Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast', 'Canberra') },
  { code: 'NZ', name: 'New Zealand', levels: 2, states: ms('Auckland', 'Wellington', 'Christchurch', 'Hamilton') },

  // Central Asia & Caucasus (inDrive, Yandex, Bolt)
  { code: 'KZ', name: 'Kazakhstan', levels: 2, states: ms('Almaty', 'Astana', 'Shymkent', 'Karaganda') },
  { code: 'UZ', name: 'Uzbekistan', levels: 2, states: ms('Tashkent', 'Samarkand', 'Bukhara') },
  { code: 'KG', name: 'Kyrgyzstan', levels: 2, states: ms('Bishkek', 'Osh') },
  { code: 'TJ', name: 'Tajikistan', levels: 2, states: ms('Dushanbe', 'Khujand') },
  { code: 'GE', name: 'Georgia', levels: 2, states: ms('Tbilisi', 'Batumi', 'Kutaisi') },
  { code: 'AZ', name: 'Azerbaijan', levels: 2, states: ms('Baku', 'Ganja') },
  { code: 'AM', name: 'Armenia', levels: 2, states: ms('Yerevan', 'Gyumri') },

  // CIS / Eastern Europe (Uber-past→Yandex, inDrive, Bolt)
  { code: 'RU', name: 'Russia', levels: 2, states: ms('Moscow', 'Saint Petersburg', 'Novosibirsk', 'Yekaterinburg', 'Kazan', 'Sochi') },
  { code: 'UA', name: 'Ukraine', levels: 2, states: ms('Kyiv', 'Kharkiv', 'Odesa', 'Lviv', 'Dnipro') },
  { code: 'BY', name: 'Belarus', levels: 2, states: ms('Minsk', 'Gomel') },
  { code: 'MD', name: 'Moldova', levels: 2, states: ms('Chișinău', 'Bălți') },

  // Western & Northern Europe (Uber, Bolt)
  { code: 'GB', name: 'United Kingdom', levels: 2, states: ms('London', 'Manchester', 'Birmingham', 'Glasgow', 'Leeds', 'Liverpool', 'Edinburgh', 'Bristol') },
  { code: 'IE', name: 'Ireland', levels: 2, states: ms('Dublin', 'Cork', 'Galway', 'Limerick') },
  { code: 'FR', name: 'France', levels: 2, states: ms('Paris', 'Lyon', 'Marseille', 'Lille', 'Bordeaux', 'Toulouse', 'Nice', 'Nantes') },
  { code: 'DE', name: 'Germany', levels: 2, states: ms('Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne', 'Düsseldorf', 'Stuttgart') },
  { code: 'NL', name: 'Netherlands', levels: 2, states: ms('Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven') },
  { code: 'BE', name: 'Belgium', levels: 2, states: ms('Brussels', 'Antwerp', 'Ghent', 'Liège') },
  { code: 'LU', name: 'Luxembourg', levels: 2, states: ms('Luxembourg City', 'Esch-sur-Alzette', 'Differdange', 'Dudelange', 'Ettelbruck') },
  { code: 'CH', name: 'Switzerland', levels: 2, states: ms('Zurich', 'Geneva', 'Basel', 'Lausanne', 'Bern') },
  { code: 'AT', name: 'Austria', levels: 2, states: ms('Vienna', 'Graz', 'Linz', 'Salzburg') },
  { code: 'SE', name: 'Sweden', levels: 2, states: ms('Stockholm', 'Gothenburg', 'Malmö', 'Uppsala') },
  { code: 'FI', name: 'Finland', levels: 2, states: ms('Helsinki', 'Espoo', 'Tampere', 'Turku') },
  { code: 'NO', name: 'Norway', levels: 2, states: ms('Oslo', 'Bergen', 'Trondheim', 'Stavanger') },
  { code: 'DK', name: 'Denmark', levels: 2, states: ms('Copenhagen', 'Aarhus', 'Odense', 'Aalborg') },

  // Southern Europe (Uber, Bolt)
  { code: 'ES', name: 'Spain', levels: 2, states: ms('Madrid', 'Barcelona', 'Valencia', 'Seville', 'Málaga', 'Bilbao') },
  { code: 'PT', name: 'Portugal', levels: 2, states: ms('Lisbon', 'Porto', 'Faro', 'Braga') },
  { code: 'IT', name: 'Italy', levels: 2, states: ms('Rome', 'Milan', 'Naples', 'Turin', 'Florence', 'Bologna') },
  { code: 'GR', name: 'Greece', levels: 2, states: ms('Athens', 'Thessaloniki', 'Patras', 'Heraklion') },
  { code: 'MT', name: 'Malta', levels: 2, states: ms('Valletta', 'Sliema', 'St. Julian’s') },
  { code: 'CY', name: 'Cyprus', levels: 2, states: ms('Nicosia', 'Limassol', 'Larnaca') },

  // Central & Southeast Europe (Bolt, Uber)
  { code: 'PL', name: 'Poland', levels: 2, states: ms('Warsaw', 'Kraków', 'Wrocław', 'Gdańsk', 'Poznań', 'Łódź') },
  { code: 'CZ', name: 'Czechia', levels: 2, states: ms('Prague', 'Brno', 'Ostrava', 'Plzeň') },
  { code: 'SK', name: 'Slovakia', levels: 2, states: ms('Bratislava', 'Košice', 'Žilina') },
  { code: 'HU', name: 'Hungary', levels: 2, states: ms('Budapest', 'Debrecen', 'Szeged') },
  { code: 'RO', name: 'Romania', levels: 2, states: ms('Bucharest', 'Cluj-Napoca', 'Timișoara', 'Iași', 'Brașov') },
  { code: 'BG', name: 'Bulgaria', levels: 2, states: ms('Sofia', 'Plovdiv', 'Varna', 'Burgas') },
  { code: 'HR', name: 'Croatia', levels: 2, states: ms('Zagreb', 'Split', 'Rijeka', 'Dubrovnik') },
  { code: 'SI', name: 'Slovenia', levels: 2, states: ms('Ljubljana', 'Maribor') },
  { code: 'RS', name: 'Serbia', levels: 2, states: ms('Belgrade', 'Novi Sad', 'Niš') },
  { code: 'BA', name: 'Bosnia & Herzegovina', levels: 2, states: ms('Sarajevo', 'Banja Luka', 'Mostar') },
  { code: 'ME', name: 'Montenegro', levels: 2, states: ms('Podgorica', 'Budva') },
  { code: 'MK', name: 'North Macedonia', levels: 2, states: ms('Skopje', 'Bitola') },
  { code: 'AL', name: 'Albania', levels: 2, states: ms('Tirana', 'Durrës', 'Vlorë') },
  { code: 'EE', name: 'Estonia', levels: 2, states: ms('Tallinn', 'Tartu', 'Pärnu') },
  { code: 'LV', name: 'Latvia', levels: 2, states: ms('Riga', 'Daugavpils') },
  { code: 'LT', name: 'Lithuania', levels: 2, states: ms('Vilnius', 'Kaunas', 'Klaipėda') },

  // Middle East (Uber, Careem, Bolt, inDrive)
  { code: 'TR', name: 'Turkey', levels: 2, states: ms('Istanbul', 'Ankara', 'İzmir', 'Antalya', 'Bursa') },
  { code: 'AE', name: 'United Arab Emirates', levels: 2, states: ms('Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman') },
  { code: 'SA', name: 'Saudi Arabia', levels: 2, states: ms('Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam') },
  { code: 'QA', name: 'Qatar', levels: 2, states: ms('Doha', 'Al Rayyan') },
  { code: 'BH', name: 'Bahrain', levels: 2, states: ms('Manama', 'Riffa') },
  { code: 'KW', name: 'Kuwait', levels: 2, states: ms('Kuwait City', 'Hawalli') },
  { code: 'OM', name: 'Oman', levels: 2, states: ms('Muscat', 'Salalah') },
  { code: 'JO', name: 'Jordan', levels: 2, states: ms('Amman', 'Zarqa', 'Irbid') },
  { code: 'LB', name: 'Lebanon', levels: 2, states: ms('Beirut', 'Tripoli', 'Sidon') },
  { code: 'IQ', name: 'Iraq', levels: 2, states: ms('Baghdad', 'Basra', 'Erbil', 'Mosul') },
  { code: 'IL', name: 'Israel', levels: 2, states: ms('Tel Aviv', 'Jerusalem', 'Haifa') },

  // North Africa & Middle East crossover (Uber, Careem, inDrive, Bolt)
  { code: 'EG', name: 'Egypt', levels: 2, states: ms('Cairo', 'Alexandria', 'Giza', 'Sharm El Sheikh') },
  { code: 'MA', name: 'Morocco', levels: 2, states: ms('Casablanca', 'Rabat', 'Marrakesh', 'Tangier') },
  { code: 'TN', name: 'Tunisia', levels: 2, states: ms('Tunis', 'Sfax', 'Sousse') },
  { code: 'DZ', name: 'Algeria', levels: 2, states: ms('Algiers', 'Oran', 'Constantine') },

  // Sub-Saharan Africa (Uber, Bolt, inDrive)
  { code: 'NG', name: 'Nigeria', levels: 2, states: ms('Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano') },
  { code: 'ZA', name: 'South Africa', levels: 2, states: ms('Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth') },
  { code: 'KE', name: 'Kenya', levels: 2, states: ms('Nairobi', 'Mombasa', 'Kisumu', 'Nakuru') },
  { code: 'GH', name: 'Ghana', levels: 2, states: ms('Accra', 'Kumasi', 'Tamale') },
  { code: 'TZ', name: 'Tanzania', levels: 2, states: ms('Dar es Salaam', 'Arusha', 'Dodoma', 'Mwanza') },
  { code: 'UG', name: 'Uganda', levels: 2, states: ms('Kampala', 'Entebbe', 'Gulu') },
  { code: 'CI', name: 'Côte d’Ivoire', levels: 2, states: ms('Abidjan', 'Yamoussoukro', 'Bouaké') },
  { code: 'SN', name: 'Senegal', levels: 2, states: ms('Dakar', 'Touba', 'Thiès') },
  { code: 'CM', name: 'Cameroon', levels: 2, states: ms('Douala', 'Yaoundé') },
  { code: 'ET', name: 'Ethiopia', levels: 2, states: ms('Addis Ababa', 'Dire Dawa') },
  { code: 'MZ', name: 'Mozambique', levels: 2, states: ms('Maputo', 'Matola', 'Beira') },
  { code: 'ZM', name: 'Zambia', levels: 2, states: ms('Lusaka', 'Kitwe', 'Ndola') },
  { code: 'AO', name: 'Angola', levels: 2, states: ms('Luanda', 'Huambo') },
  { code: 'ZW', name: 'Zimbabwe', levels: 2, states: ms('Harare', 'Bulawayo') },
  { code: 'RW', name: 'Rwanda', levels: 2, states: ms('Kigali') },
  { code: 'CD', name: 'DR Congo', levels: 2, states: ms('Kinshasa', 'Lubumbashi') },
  { code: 'NA', name: 'Namibia', levels: 2, states: ms('Windhoek', 'Walvis Bay') },
  { code: 'BW', name: 'Botswana', levels: 2, states: ms('Gaborone', 'Francistown') },

  // North America (Uber, inDrive, Bolt-trial)
  { code: 'CA', name: 'Canada', levels: 2, states: ms('Toronto', 'Montreal', 'Vancouver', 'Calgary', 'Ottawa', 'Edmonton') },
  { code: 'MX', name: 'Mexico', levels: 2, states: ms('Mexico City', 'Guadalajara', 'Monterrey', 'Puebla', 'Cancún', 'Tijuana') },

  // Central America & Caribbean (Uber, inDrive)
  { code: 'GT', name: 'Guatemala', levels: 2, states: ms('Guatemala City', 'Quetzaltenango') },
  { code: 'SV', name: 'El Salvador', levels: 2, states: ms('San Salvador', 'Santa Ana') },
  { code: 'HN', name: 'Honduras', levels: 2, states: ms('Tegucigalpa', 'San Pedro Sula') },
  { code: 'NI', name: 'Nicaragua', levels: 2, states: ms('Managua', 'León') },
  { code: 'CR', name: 'Costa Rica', levels: 2, states: ms('San José', 'Alajuela') },
  { code: 'PA', name: 'Panama', levels: 2, states: ms('Panama City', 'Colón') },
  { code: 'DO', name: 'Dominican Republic', levels: 2, states: ms('Santo Domingo', 'Santiago', 'Punta Cana') },
  { code: 'PR', name: 'Puerto Rico', levels: 2, states: ms('San Juan', 'Bayamón', 'Ponce') },
  { code: 'TT', name: 'Trinidad & Tobago', levels: 2, states: ms('Port of Spain', 'San Fernando') },

  // South America (Uber, inDrive, Bolt, Cabify)
  { code: 'BR', name: 'Brazil', levels: 2, states: ms('São Paulo', 'Rio de Janeiro', 'Brasília', 'Belo Horizonte', 'Salvador', 'Fortaleza', 'Curitiba', 'Recife') },
  { code: 'AR', name: 'Argentina', levels: 2, states: ms('Buenos Aires', 'Córdoba', 'Rosario', 'Mendoza', 'La Plata') },
  { code: 'CL', name: 'Chile', levels: 2, states: ms('Santiago', 'Valparaíso', 'Concepción', 'Antofagasta') },
  { code: 'CO', name: 'Colombia', levels: 2, states: ms('Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena') },
  { code: 'PE', name: 'Peru', levels: 2, states: ms('Lima', 'Arequipa', 'Trujillo', 'Cusco') },
  { code: 'EC', name: 'Ecuador', levels: 2, states: ms('Quito', 'Guayaquil', 'Cuenca') },
  { code: 'BO', name: 'Bolivia', levels: 2, states: ms('La Paz', 'Santa Cruz', 'Cochabamba') },
  { code: 'PY', name: 'Paraguay', levels: 2, states: ms('Asunción', 'Ciudad del Este') },
  { code: 'UY', name: 'Uruguay', levels: 2, states: ms('Montevideo', 'Salto') },
  { code: 'VE', name: 'Venezuela', levels: 2, states: ms('Caracas', 'Maracaibo', 'Valencia') },
];

export function countryByCode(code: string): CountryData | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

/** Flag emoji from an ISO 3166-1 alpha-2 code via Unicode regional indicators. */
export function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';
  const base = 0x1f1e6;
  const cc = code.toUpperCase();
  return String.fromCodePoint(base + cc.charCodeAt(0) - 65, base + cc.charCodeAt(1) - 65);
}

export function statesOf(code: string): string[] {
  const c = countryByCode(code);
  return c ? Object.keys(c.states) : [];
}

export function citiesOf(code: string, state: string): string[] {
  const c = countryByCode(code);
  return c?.states[state] ?? [];
}

/** Default payment currency for a country (its real ISO 4217 currency). */
export function currencyForCountry(code: string): Currency {
  return COUNTRY_CURRENCY[code] ?? 'USD';
}

/**
 * Currency implied by a market/topic slug. Market keys start with the slugged
 * ISO-3166 country ("vn_hanoi_ridesharing" → VN → VND; the legacy demo key
 * "sg-rideshare" → SG → SGD), so an offer on a post priced in that market can
 * default to the POST's currency — not the responder's. A Singapore-based user
 * offering on a Hanoi ride must see VND, whatever their device/location says.
 */
export function currencyForMarket(market: string | undefined, fallback: Currency): Currency {
  const cc = String(market || '').split(/[_-]/)[0].toUpperCase();
  return (cc.length === 2 && COUNTRY_CURRENCY[cc]) || fallback;
}

/** Currency to prefill in an offer/respond form. Priority:
 *  1. The post's explicit asking price → its currency (poster's choice).
 *  2. The PICKUP's country — a ride is paid at the curb in the pickup
 *     country's money (user report: a Vietnam-pickup post that landed in an
 *     SG market offered S$; it must offer ₫).
 *  3. The market topic's country, else USD. */
export function offerCurrency(
  explicit: Currency | null | undefined,
  pickupCountry: string | null | undefined,
  market: string | undefined,
): Currency {
  if (explicit) return explicit;
  const cc = (pickupCountry || '').toUpperCase();
  if (cc && COUNTRY_CURRENCY[cc]) return COUNTRY_CURRENCY[cc];
  return currencyForMarket(market, 'USD');
}

/** Minor-unit count for a currency (0 for VND/JPY/KRW…, usually 2). */
export function currencyFractionDigits(currency: Currency): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Narrow currency symbol (₫, S$, $, €, ¥…). Falls back to the ISO code. */
export function currencySymbol(currency: Currency): string {
  if (currency === 'VND') return '₫';
  if (currency === 'SGD') return 'S$';
  try {
    const parts = new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/**
 * Format a money amount in its currency for display.
 * Vietnam and Singapore keep their established local look (123.456₫ / S$50);
 * every other currency uses Intl with its narrow symbol and native digits.
 */
export function fmtMoney(amount: number, currency: Currency): string {
  const lang = getI18nLang();
  if (currency === 'VND') return `${amount.toLocaleString(lang)}₫`;
  if (currency === 'SGD') return Number.isInteger(amount) ? `S$${amount.toLocaleString(lang)}` : `S$${amount.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(amount);
  } catch {
    return `${currencySymbol(currency)}${amount.toLocaleString(lang)}`;
  }
}

/** Address depth for a country (1–3). Unknown → 2 (country→state). */
export function levelsOf(code: string): 1 | 2 | 3 {
  return countryByCode(code)?.levels ?? 2;
}

/** Lowercase + strip diacritics for fuzzy matching ("Hồ Chí Minh" ↔ "Ho Chi Minh"). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

/** Space/hyphen-insensitive form so "Hanoi" ↔ "Hà Nội", "North-East" ↔ "North East". */
function tight(s: string): string {
  return s.replace(/[\s-]/g, '');
}

function fuzzyFind(options: string[], query: string): string {
  const q = norm(query);
  if (!q) return '';
  const qt = tight(q);
  return (
    options.find((o) => norm(o) === q) ||
    options.find((o) => norm(o).includes(q) || q.includes(norm(o))) ||
    // Space/hyphen-insensitive ("Hanoi" ↔ "Hà Nội", "North-East" ↔ "North East")
    options.find((o) => tight(norm(o)).includes(qt) || qt.includes(tight(norm(o)))) ||
    ''
  );
}

/**
 * Map a detected (countryCode, region, city) onto our curated dataset.
 * Returns null if the country isn't supported; state/city are '' when no
 * confident match (the user can refine manually).
 */
export function matchLocation(
  countryCode: string | undefined,
  region: string | undefined,
  city: string | undefined,
): { country: string; state: string; city: string } | null {
  const c = countryByCode((countryCode ?? '').toUpperCase());
  if (!c) return null;
  // Respect the country's address depth: don't fill levels it doesn't use.
  const state = c.levels >= 2 && region ? fuzzyFind(statesOf(c.code), region) : '';
  const cityMatch = c.levels >= 3 && state && city ? fuzzyFind(citiesOf(c.code, state), city) : '';
  return { country: c.code, state, city: cityMatch };
}

/** A quick-search hit: a full picked location plus a human display label. */
export interface LocationOption {
  country: string;
  state: string;
  city: string;
  label: string;   // e.g. "🇻🇳  Hà Nội, Vietnam" or "🇺🇸  Brooklyn · New York, United States"
  level: 1 | 2 | 3; // 1 = country, 2 = state, 3 = city (used only for ranking)
}

// Flat index of every searchable place (country / state / city), built once.
// Each entry caches its diacritic- and space-insensitive key for fast matching.
let _searchIndex: { key: string; opt: LocationOption }[] | null = null;
function buildSearchIndex(): { key: string; opt: LocationOption }[] {
  const out: { key: string; opt: LocationOption }[] = [];
  for (const c of COUNTRIES) {
    const flag = flagEmoji(c.code);
    out.push({ key: tight(norm(`${c.name} ${c.code}`)), opt: { country: c.code, state: '', city: '', label: `${flag}  ${c.name}`, level: 1 } });
    if (c.levels >= 2) {
      for (const [st, cities] of Object.entries(c.states)) {
        if (!st) continue;
        out.push({ key: tight(norm(st)), opt: { country: c.code, state: st, city: '', label: `${flag}  ${st}, ${c.name}`, level: 2 } });
        if (c.levels >= 3) {
          for (const city of cities) {
            out.push({ key: tight(norm(city)), opt: { country: c.code, state: st, city, label: `${flag}  ${city} · ${st}, ${c.name}`, level: 3 } });
          }
        }
      }
    }
  }
  return out;
}

/**
 * Fuzzy quick-search across all countries/states/cities for the location picker.
 * Diacritic- and space-insensitive, so "Han" → "Hà Nội" and "hochiminh" → "Hồ
 * Chí Minh". Prefix matches rank above substring matches; then by level (more
 * specific first). Returns at most `limit` results; '' for queries under 2 chars.
 */
export function searchLocations(query: string, limit = 8): LocationOption[] {
  const qt = tight(norm(query));
  if (qt.length < 2) return [];
  const idx = (_searchIndex ??= buildSearchIndex());
  const starts: LocationOption[] = [];
  const contains: LocationOption[] = [];
  for (const e of idx) {
    if (e.key.startsWith(qt)) starts.push(e.opt);
    else if (e.key.includes(qt)) contains.push(e.opt);
  }
  const byLevel = (a: LocationOption, b: LocationOption) => b.level - a.level || a.label.localeCompare(b.label);
  starts.sort(byLevel);
  contains.sort(byLevel);
  return [...starts, ...contains].slice(0, limit);
}
