/**
 * Ядро розрахунку фосфорного живлення (Bactogran Phosphorus Engine)
 *
 * @param {Object} input - Вхідні дані для розрахунку
 * @param {number} input.area - Площа поля в га
 * @param {string} input.crop - Назва культури
 * @param {number} input.plannedYield - Запланована врожайність (т/га)
 * @param {string} input.soilP - Рівень забезпеченості фосфором ("Низька", "Середня", "Висока", "Не маю даних...")
 * @param {string} input.pH - Показник pH ("до 5.5", "5.5", "6.0", "6.5", "7.0", "7.5", "більше 7.5")
 *
 * @returns {Object} Об'єкт із результатами розрахунку
 */
function calculatePhosphorus(input) {
  // 1. Валідація та нормалізація вхідних даних
  const area = parseNumberUA(input.area);
  const crop = String(input.crop || '').trim();
  const plannedYield = parseNumberUA(input.plannedYield);
  const soilP = String(input.soilP || '').trim();
  const pH = String(input.pH || '').trim();

  if (!crop || plannedYield === null || !soilP || !pH || area === null || area <= 0) {
    throw new Error('Не коректно або не повністю заповнені вхідні параметри поля.');
  }

  // 2. Отримання базових показників із довідників
  const removalP2O5 = getTableValueByCropAndYield(
    'Довідники',
    'A13:X18',
    crop,
    plannedYield
  );

  let recommendation = getRecommendedP2O5FromTables(
    crop,
    plannedYield,
    soilP,
    pH
  );

  const minNorm = getLookupValue('Довідники', 'L:M', 'Мінімальна_норма_P2O5') || 10;

  if (removalP2O5 === null) {
    throw new Error(`Не знайдено винос P₂O₅ для "${crop}" та урожайності ${plannedYield} т/га.`);
  }

  if (recommendation === null) {
    throw new Error(`Не знайдено рекомендовану норму P₂O₅ для обраних параметрів.`);
  }

  // 3. Застосування обмежень та розрахунок підсумків
  recommendation = Math.max(minNorm, recommendation);
  const totalP2O5 = recommendation * area;
  const products = getBactogranProductsFromDictionary(recommendation, area);
  const status = getStatusFromDictionary(recommendation);
  const comment = getSystemComment(soilP, pH, plannedYield);

  // 4. Повернення чистого об'єкта результату
  return {
    area: area,
    crop: crop,
    plannedYield: plannedYield,
    soilP: soilP,
    pH: pH,
    removalP2O5: round(removalP2O5),
    recommendationP2O5: round(recommendation),
    totalP2O5Kg: round(totalP2O5),
    totalP2O5Tons: round(totalP2O5 / 1000),
    status: status,
    comment: comment,
    products: products
  };
}