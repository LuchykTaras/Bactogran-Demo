const APP_VERSION = '1.0.0';
const DICTIONARY_SHEET = 'Довідники';

const SOIL_OPTIONS = [
  'Низька',
  'Середня',
  'Висока',
  'Не маю даних аналізу ґрунту'
];

const PH_OPTIONS = [
  'до 5.5',
  '5.5',
  '6.0',
  '6.5',
  '7.0',
  '7.5',
  'більше 7.5'
];

const SESSION_TTL_SECONDS = 7200;
const RATE_LIMIT_SECONDS = 600;
const MAX_REQUESTS_PER_SESSION = 30;
const MAX_AREA_HA = 2000000;


/* =========================================================
   WEB APP
========================================================= */

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');

  template.sessionToken = createSessionToken_();
  template.appVersion = APP_VERSION;

  return template
    .evaluate()
    .setTitle('Bactogran Calculator')
    .addMetaTag(
      'viewport',
      'width=device-width, initial-scale=1, viewport-fit=cover'
    );
}


/* =========================================================
   PUBLIC API FOR HTML
========================================================= */

function getAppData(sessionToken) {
  validateSession_(sessionToken);

  try {
    return getPublicAppData_();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);

    throw new Error(
      'Не вдалося завантажити довідники калькулятора. Оновіть сторінку.'
    );
  }
}


function calculateWeb(input, sessionToken) {
  validateSession_(sessionToken);
  consumeRequestQuota_(sessionToken);

  try {
    return calculateFertilizer_(input);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);

    if (error && error.name === 'ValidationError') {
      throw new Error(error.message);
    }

    throw new Error(
      'Не вдалося виконати розрахунок. Перевірте параметри та повторіть спробу.'
    );
  }
}


/* =========================================================
   CONFIGURATION
========================================================= */

function getReferenceSpreadsheet_() {
  const spreadsheetId = PropertiesService
    .getScriptProperties()
    .getProperty('REFERENCE_SPREADSHEET_ID');

  if (!spreadsheetId) {
    throw new Error(
      'Не задано Script Property REFERENCE_SPREADSHEET_ID.'
    );
  }

  return SpreadsheetApp.openById(spreadsheetId);
}


function getDictionarySheet_() {
  const sheet = getReferenceSpreadsheet_()
    .getSheetByName(DICTIONARY_SHEET);

  if (!sheet) {
    throw new Error(
      `У таблиці не знайдено аркуш "${DICTIONARY_SHEET}".`
    );
  }

  return sheet;
}


/**
 * Запустити вручну один раз після налаштування Script Properties.
 */
function verifyConfiguration() {
  const spreadsheet = getReferenceSpreadsheet_();
  const sheet = getDictionarySheet_();
  const data = getPublicAppData_(true);

  console.log(`Таблиця: ${spreadsheet.getName()}`);
  console.log(`Аркуш: ${sheet.getName()}`);
  console.log(`Культури: ${data.crops.join(', ')}`);
}


/**
 * Простий тест розрахунку.
 */
function runSmokeTest() {
  const data = getPublicAppData_(true);

  const crop = data.crops[0];
  const plannedYield = data.yieldMap[crop][0];

  const result = calculateFertilizer_({
    area: 100,
    crop,
    plannedYield,
    soilP: 'Середня',
    pH: '6.0'
  });

  console.log(JSON.stringify(result, null, 2));
}


/**
 * Запустити після зміни даних на аркуші "Довідники".
 */
function clearCalculatorCache() {
  CacheService
    .getScriptCache()
    .remove(`public-data-${APP_VERSION}`);
}


/* =========================================================
   SESSION PROTECTION
========================================================= */

function createSessionToken_() {
  const token = Utilities.getUuid();

  CacheService
    .getScriptCache()
    .put(
      `session:${token}`,
      'active',
      SESSION_TTL_SECONDS
    );

  return token;
}


function validateSession_(token) {
  if (!token || typeof token !== 'string') {
    throw new Error(
      'Сесію не підтверджено. Оновіть сторінку.'
    );
  }

  const session = CacheService
    .getScriptCache()
    .get(`session:${token}`);

  if (session !== 'active') {
    throw new Error(
      'Сесія завершилась. Оновіть сторінку калькулятора.'
    );
  }
}


function consumeRequestQuota_(token) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  const key = `requests:${token}`;

  if (!lock.tryLock(5000)) {
    throw new Error(
      'Сервіс тимчасово зайнятий. Повторіть спробу.'
    );
  }

  try {
    const current = Number(cache.get(key) || 0);
    const next = current + 1;

    if (next > MAX_REQUESTS_PER_SESSION) {
      throw new Error(
        'Забагато розрахунків за короткий час. Зачекайте кілька хвилин.'
      );
    }

    cache.put(
      key,
      String(next),
      RATE_LIMIT_SECONDS
    );

  } finally {
    lock.releaseLock();
  }
}


/* =========================================================
   PUBLIC OPTIONS
========================================================= */

function getPublicAppData_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  const cacheKey = `public-data-${APP_VERSION}`;

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }
  }

  const yieldMap = getYieldMap_();
  const crops = Object.keys(yieldMap);

  if (!crops.length) {
    throw new Error(
      'Не знайдено культур у діапазоні AA1:AE30.'
    );
  }

  const result = {
    version: APP_VERSION,
    crops,
    yieldMap,
    soilOptions: SOIL_OPTIONS,
    phOptions: PH_OPTIONS,

    privacyText:
      'Калькулятор не запитує та не зберігає ПІБ, телефон або Email. ' +
      'Параметри поля використовуються лише для поточного розрахунку.',

    disclaimer:
      'Результат має рекомендаційний характер. Для остаточного рішення ' +
      'враховуйте аналіз ґрунту, технологію вирощування та рекомендації агронома.'
  };

  cache.put(
    cacheKey,
    JSON.stringify(result),
    600
  );

  return result;
}


function getYieldMap_() {
  const values = getDictionarySheet_()
    .getRange('AA1:AE30')
    .getValues();

  const headers = values[0].map(value =>
    String(value || '').trim()
  );

  const yieldMap = {};

  headers.forEach((crop, columnIndex) => {
    if (!crop) return;

    const options = values
      .slice(1)
      .map(row => parseNumberUA_(row[columnIndex]))
      .filter(value => value !== null && value > 0);

    const uniqueOptions = [...new Set(options)]
      .sort((a, b) => a - b);

    if (uniqueOptions.length) {
      yieldMap[crop] = uniqueOptions;
    }
  });

  return yieldMap;
}


/* =========================================================
   MAIN CALCULATION
========================================================= */

function calculateFertilizer_(rawInput) {
  const input = validateInput_(rawInput);

  const removalP2O5 = getTableValueByCropAndYield_(
    'A13:X18',
    input.crop,
    input.plannedYield
  );

  let recommendation = getRecommendedP2O5_(
    input.crop,
    input.plannedYield,
    input.soilP,
    input.pH
  );

  const minNorm =
    getLookupValue_('Мінімальна_норма_P2O5') || 10;

  if (removalP2O5 === null) {
    throw validationError_(
      'Не знайдено винос P₂O₅ для обраної культури та врожайності.'
    );
  }

  if (recommendation === null) {
    throw validationError_(
      'Не знайдено рекомендовану норму P₂O₅ для обраних параметрів.'
    );
  }

  recommendation = Math.max(
    minNorm,
    recommendation
  );

  const totalP2O5Kg =
    recommendation * input.area;

  const products =
    getBactogranProducts_(
      recommendation,
      input.area
    );

  return {
    removalP2O5: round_(removalP2O5),
    removalLabel:
      `${formatNumberUA_(round_(removalP2O5))} кг/га`,

    recommendationP2O5: round_(recommendation),
    recommendationLabel:
      `${formatNumberUA_(round_(recommendation))} кг/га`,

    totalP2O5Kg: round_(totalP2O5Kg),
    totalP2O5Tons: round_(totalP2O5Kg / 1000),

    totalP2O5Label:
      `${formatNumberUA_(round_(totalP2O5Kg / 1000))} т на всю площу`,

    status:
      getStatus_(recommendation),

    comment:
      getSystemComment_(
        input.soilP,
        input.pH,
        input.plannedYield
      ),

    products: products.map(product => ({
      name: product.name,
      rateLabel:
        `${formatNumberUA_(product.rate)} кг/га`,
      totalLabel:
        `${formatNumberUA_(product.totalTons)} т на площу ` +
        `${formatNumberUA_(input.area)} га`
    })),

    explanation: {
      title:
        'Доступні рішення Bactogran для забезпечення потреби культури у фосфорі',

      intro:
        `Для досягнення запланованої врожайності ` +
        `${input.crop.toLowerCase()} ` +
        `${formatNumberUA_(input.plannedYield)} т/га ` +
        `можна обрати один із наведених продуктів Bactogran.`,

      fallback:
        'Потрібна консультація агронома Bactogran для уточнення системи живлення.',

      soilActive:
        'Біокомплекс Soil Active додатково мобілізує 10 кг/га ' +
        'доступного фосфору та попереджає його блокування на кислих ' +
        'і лужних ґрунтах. Це сприяє розвитку кореневої системи, ' +
        'ефективнішому використанню елементів живлення та стабільному ' +
        'формуванню запланованого врожаю.'
    }
  };
}


/* =========================================================
   VALIDATION
========================================================= */

function validateInput_(rawInput) {
  if (!rawInput || typeof rawInput !== 'object') {
    throw validationError_(
      'Не передано дані для розрахунку.'
    );
  }

  const appData = getPublicAppData_();

  const area = parseNumberUA_(rawInput.area);
  const crop = String(rawInput.crop || '').trim();
  const plannedYield =
    parseNumberUA_(rawInput.plannedYield);
  const soilP = String(rawInput.soilP || '').trim();
  const pH = String(rawInput.pH || '').trim();

  if (
    area === null ||
    area <= 0 ||
    area > MAX_AREA_HA
  ) {
    throw validationError_(
      'Вкажіть коректну площу поля.'
    );
  }

  if (!appData.crops.includes(crop)) {
    throw validationError_(
      'Оберіть культуру зі списку.'
    );
  }

  const allowedYields =
    appData.yieldMap[crop] || [];

  const yieldAllowed = allowedYields.some(
    value =>
      Math.abs(value - plannedYield) < 0.000001
  );

  if (
    plannedYield === null ||
    !yieldAllowed
  ) {
    throw validationError_(
      'Оберіть урожайність для вибраної культури.'
    );
  }

  if (!SOIL_OPTIONS.includes(soilP)) {
    throw validationError_(
      'Оберіть рівень забезпеченості фосфором.'
    );
  }

  if (!PH_OPTIONS.includes(pH)) {
    throw validationError_(
      'Оберіть pH зі списку.'
    );
  }

  return {
    area,
    crop,
    plannedYield,
    soilP,
    pH
  };
}


function validationError_(message) {
  const error = new Error(message);
  error.name = 'ValidationError';
  return error;
}


/* =========================================================
   TABLE LOOKUPS
========================================================= */

function getTableValueByCropAndYield_(
  rangeA1,
  crop,
  plannedYield
) {
  const values = getDictionarySheet_()
    .getRange(rangeA1)
    .getValues();

  const yieldRow = values[0];
  let yieldColumn = -1;

  for (
    let column = 1;
    column < yieldRow.length;
    column++
  ) {
    const headerYield =
      parseNumberUA_(yieldRow[column]);

    if (
      headerYield !== null &&
      Math.abs(
        headerYield - plannedYield
      ) < 0.000001
    ) {
      yieldColumn = column;
      break;
    }
  }

  if (yieldColumn === -1) {
    return null;
  }

  for (
    let row = 1;
    row < values.length;
    row++
  ) {
    const rowCrop =
      String(values[row][0] || '').trim();

    if (rowCrop === crop) {
      const rawValue =
        values[row][yieldColumn];

      if (
        rawValue === '' ||
        rawValue === null
      ) {
        return null;
      }

      const number = Number(rawValue);

      return Number.isFinite(number)
        ? number
        : null;
    }
  }

  return null;
}


function getRecommendedP2O5_(
  crop,
  plannedYield,
  soilP,
  pH
) {
  const soilLevel =
    normalizeSoilLevel_(soilP);

  const phLevel =
    normalizePhLevel_(pH);

  const range =
    getRecommendationRange_(
      soilLevel,
      phLevel
    );

  if (!range) {
    return null;
  }

  return getTableValueByCropAndYield_(
    range,
    crop,
    plannedYield
  );
}


function normalizeSoilLevel_(soilP) {
  const value = String(soilP).trim();

  if (value.includes('Не маю')) {
    return 'Середній';
  }

  if (value.includes('Низька')) {
    return 'Низький';
  }

  if (value.includes('Середня')) {
    return 'Середній';
  }

  if (value.includes('Висока')) {
    return 'Високий';
  }

  return null;
}


function normalizePhLevel_(pH) {
  const value = String(pH)
    .trim()
    .replace(',', '.')
    .toLowerCase();

  if (value.includes('до')) {
    return 5;
  }

  if (value.includes('більше')) {
    return 8;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  if (number < 5.5) return 5;
  if (number <= 6.0) return 6;
  if (number <= 7.0) return 7;

  return 8;
}


function getRecommendationRange_(
  soilLevel,
  phLevel
) {
  const ranges = {
    'Низький_5': 'Z42:AW48',
    'Низький_6': 'AY42:BV48',
    'Низький_7': 'BX42:CU48',
    'Низький_8': 'CW42:DT48',

    'Середній_5': 'Z52:AW58',
    'Середній_6': 'AY52:BV58',
    'Середній_7': 'BX52:CU58',
    'Середній_8': 'CW52:DT58',

    'Високий_5': 'Z62:AW68',
    'Високий_6': 'AY62:BV68',
    'Високий_7': 'BX62:CU68',
    'Високий_8': 'CW62:DT68'
  };

  return ranges[
    `${soilLevel}_${phLevel}`
  ] || null;
}


function getLookupValue_(searchKey) {
  const sheet = getDictionarySheet_();
  const lastRow = sheet.getLastRow();

  const values = sheet
    .getRange(1, 12, lastRow, 2)
    .getValues();

  for (
    let row = 0;
    row < values.length;
    row++
  ) {
    if (
      String(values[row][0] || '').trim() ===
      searchKey
    ) {
      const number = Number(values[row][1]);

      return Number.isFinite(number)
        ? number
        : null;
    }
  }

  return null;
}


/* =========================================================
   STATUS AND COMMENTS
========================================================= */

function getStatus_(recommendation) {
  const values = getDictionarySheet_()
    .getRange('A120:B123')
    .getValues();

  for (let row = 0; row < values.length; row++) {
    const rangeText =
      String(values[row][0] || '').trim();

    const status =
      String(values[row][1] || '').trim();

    const parts = rangeText.split('-');

    if (parts.length !== 2) continue;

    const min = Number(parts[0]);
    const max = Number(parts[1]);

    if (
      recommendation >= min &&
      recommendation <= max
    ) {
      return `${getStatusEmoji_(status)} ${status}`;
    }
  }

  return '🔴 Висока потреба у фосфорному живленні';
}


function getStatusEmoji_(status) {
  if (status.includes('Низька')) return '🟢';
  if (status.includes('Середня')) return '🟡';
  if (status.includes('Підвищена')) return '🟠';

  return '🔴';
}


function getSystemComment_(
  soilP,
  pH,
  plannedYield
) {
  const yieldText =
    formatNumberUA_(plannedYield);

  if (soilP === 'Низька') {
    return (
      `За обраних параметрів (низька забезпеченість ґрунту фосфором, ` +
      `pH ${pH}, запланована врожайність ${yieldText} т/га) ` +
      `ризик дефіциту фосфору є підвищеним. Рекомендована норма ` +
      `спрямована на компенсацію дефіциту та забезпечення потреб культури.`
    );
  }

  if (soilP === 'Середня') {
    return (
      `За обраних параметрів (середня забезпеченість ґрунту фосфором, ` +
      `pH ${pH}, запланована врожайність ${yieldText} т/га) ` +
      `ризик дефіциту фосфору є помірним. Рекомендована норма ` +
      `спрямована на підтримання балансу живлення та стабільне ` +
      `формування врожаю.`
    );
  }

  if (soilP === 'Висока') {
    return (
      `За обраних параметрів (висока забезпеченість ґрунту фосфором, ` +
      `pH ${pH}, запланована врожайність ${yieldText} т/га) ` +
      `ризик дефіциту фосфору є низьким. Рекомендована норма ` +
      `спрямована на підтримання продуктивності та компенсацію ` +
      `виносу елементів живлення урожаєм.`
    );
  }

  return (
    `Розрахунок виконано без даних аналізу ґрунту ` +
    `(запланована врожайність ${yieldText} т/га). ` +
    `Рекомендація є орієнтовною; для точнішого підбору норми ` +
    `бажано провести аналіз ґрунту.`
  );
}


/* =========================================================
   PRODUCTS
========================================================= */

function getBactogranProducts_(
  recommendation,
  area
) {
  const values = getDictionarySheet_()
    .getRange('A127:D144')
    .getValues();

  for (let row = 0; row < values.length; row++) {
    const rangeText =
      String(values[row][0] || '').trim();

    if (!rangeText.includes('-')) continue;

    const [min, max] =
      rangeText.split('-').map(Number);

    if (
      recommendation < min ||
      recommendation > max
    ) {
      continue;
    }

    const products = [];

    addProduct_(
      products,
      'Bactogran NKS 8.10.22 із біокомплексом Soil Active',
      values[row][1],
      area
    );

    addProduct_(
      products,
      'Bactogran NPK 5.16.7 із біокомплексом Soil Active',
      values[row][2],
      area
    );

    addProduct_(
      products,
      'Bactogran NP 4.28 із біокомплексом Soil Active',
      values[row][3],
      area
    );

    return products;
  }

  return [];
}


function addProduct_(
  products,
  name,
  rawRate,
  area
) {
  const rate = Number(rawRate);

  if (
    !Number.isFinite(rate) ||
    rate <= 0
  ) {
    return;
  }

  products.push({
    name,
    rate: round_(rate),
    totalTons:
      round_(rate * area / 1000)
  });
}


/* =========================================================
   UTILITIES
========================================================= */

function parseNumberUA_(value) {
  if (
    value === '' ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized = String(value)
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');

  const number = Number(normalized);

  return Number.isFinite(number)
    ? number
    : null;
}


function round_(value) {
  return Math.round(
    Number(value) * 10
  ) / 10;
}


function formatNumberUA_(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '-';
  }

  if (Number.isInteger(number)) {
    return String(number);
  }

  return number
    .toFixed(1)
    .replace('.', ',');
}