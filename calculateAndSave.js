function calculateAndSave() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Калькулятор');

  // 1. Зчитування вхідних даних з аркуша
  const area = parseNumberUA(sheet.getRange('C2').getDisplayValue());
  const crop = String(sheet.getRange('C3').getDisplayValue()).trim();
  const plannedYield = parseNumberUA(sheet.getRange('C4').getDisplayValue());
  const soilP = String(sheet.getRange('C5').getDisplayValue()).trim();
  const pH = String(sheet.getRange('C6').getDisplayValue()).trim();

  // 2. Перевірка заповнення обов'язкових полів
  if (!crop || plannedYield === null || !soilP || !pH || area === null) {
    let message = `Не всі поля заповнені:
Культура: ${crop || '-'}
Урожайність: ${plannedYield === null ? '-' : plannedYield}
Фосфор: ${soilP || '-'}
pH: ${pH || '-'}
Площа: ${area === null ? '-' : area}`;

    if (area === null) {
      message += '\n\nПісля введення площі підтвердьте значення клавішею Enter і натисніть "Розрахувати" ще раз.';
    }

    SpreadsheetApp.getUi().alert(message);
    return;
  }

  // 3. Виклик нового ядра розрахунку calculatePhosphorus
  let calcResult;
  try {
    calcResult = calculatePhosphorus({
      area: area,
      crop: crop,
      plannedYield: plannedYield,
      soilP: soilP,
      pH: pH
    });
  } catch (error) {
    SpreadsheetApp.getUi().alert(error.message);
    return;
  }

  // 4. Очищення попередніх результатів на аркуші
  sheet.getRange('C10:C12').clearContent();
  sheet.getRange('B13:F15').clearContent();
  sheet.getRange('C16:F16').clearContent();
  sheet.getRange('C18:F18').clearContent();

  // 5. Запис результатів із ядра в комірки аркуша
  sheet.getRange('C10')
    .setValue(calcResult.removalP2O5)
    .setNumberFormat('# ##0 "кг/га"');

  sheet.getRange('C11')
    .setValue(calcResult.recommendationP2O5)
    .setNumberFormat('# ##0 "кг/га"');

  sheet.getRange('C12')
    .setValue(formatBactogranProductVolume(calcResult.products, area))
    .setWrap(true)
    .setVerticalAlignment('middle');

  showBactogranExplanation(crop, plannedYield, calcResult.products);

  sheet.getRange('C16:F16')
    .setValue(calcResult.status);

  showSystemComment(soilP, pH, plannedYield);

  // 6. Збереження до CRM та логування
  saveCalculationToCRM({
    crop: crop,
    plannedYield: plannedYield,
    area: area,
    pH: pH,
    soilP: soilP,
    recommendation: calcResult.recommendationP2O5,
    totalP2O5: calcResult.totalP2O5Kg
  });

  logEvent(
    'Calculation Completed',
    `Crop: ${crop}; Yield: ${plannedYield}; Area: ${area}; Recommendation: ${calcResult.recommendationP2O5}`
  );

  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('Розрахунок виконано.');
}