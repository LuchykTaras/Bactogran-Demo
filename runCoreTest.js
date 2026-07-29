/**
 * Контрольний тест для ядра calculatePhosphorus
 */
function runCoreTest() {
  const testInput = {
    area: 100,
    crop: 'Кукурудза',
    plannedYield: 10,
    soilP: 'Середня',
    pH: '6.0'
  };

  try {
    const result = calculatePhosphorus(testInput);
    
    Logger.log('=== РЕЗУЛЬТАТ ТЕСТУВАННЯ ЯДРА ===');
    Logger.log('Культура: ' + result.crop);
    Logger.log('Площа: ' + result.area + ' га');
    Logger.log('Урожайність: ' + result.plannedYield + ' т/га');
    Logger.log('Винос P2O5: ' + result.removalP2O5 + ' кг/га');
    Logger.log('Рекомендація P2O5: ' + result.recommendationP2O5 + ' кг/га');
    Logger.log('Загалом P2O5: ' + result.totalP2O5Kg + ' кг (' + result.totalP2O5Tons + ' т)');
    Logger.log('Статус: ' + result.status);
    Logger.log('Кількість продуктів Bactogran: ' + result.products.length);
    Logger.log('=================================');
    
    SpreadsheetApp.getUi().alert('Тест успішно пройдено! Перевірте логи Apps Script.');
  } catch (error) {
    Logger.log('ПОМИЛКА ТЕСТУ: ' + error.message);
    SpreadsheetApp.getUi().alert('Помилка під час тесту: ' + error.message);
  }
}