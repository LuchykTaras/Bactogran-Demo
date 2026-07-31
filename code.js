/**
 * Головна функція розрахунку для Web App (викликається з frontend через google.script.run)
 */
function calculateWeb(input, sessionToken) {
  // Перевірка безпеки сесії (якщо використовується)
  if (typeof validateSession_ === 'function') {
    validateSession_(sessionToken);
  }
  if (typeof consumeRequestQuota_ === 'function') {
    consumeRequestQuota_(sessionToken);
  }

  try {
    // Всі розрахунки повністю делегуємо новому ядру calculatePhosphorus
    const rawResult = calculatePhosphorus(input);

    // Форматуємо відповідь під вимоги веб-інтерфейсу (index.html)
    return {
      removalP2O5: rawResult.removalP2O5,
      removalLabel: `${formatNumberUA_(rawResult.removalP2O5)} кг/га`,

      recommendationP2O5: rawResult.recommendationP2O5,
      recommendationLabel: `${formatNumberUA_(rawResult.recommendationP2O5)} кг/га`,

      totalP2O5Kg: rawResult.totalP2O5Kg,
      totalP2O5Tons: rawResult.totalP2O5Tons,
      totalP2O5Label: `${formatNumberUA_(rawResult.totalP2O5Tons)} т на всю площу`,

      status: rawResult.status,
      comment: rawResult.comment,

      products: rawResult.products.map(product => ({
        name: product.name,
        rateLabel: `${formatNumberUA_(product.rate)} кг/га`,
        totalLabel: `${formatNumberUA_(product.totalTons)} т на площу ${formatNumberUA_(rawResult.area)} га`
      })),

      explanation: {
        title: 'Доступні рішення Bactogran для забезпечення потреби культури у фосфорі',
        intro: `Для досягнення запланованої врожайності ${rawResult.crop.toLowerCase()} ${formatNumberUA_(rawResult.plannedYield)} т/га можна обрати один із наведених продуктів Bactogran:`,
        fallback: 'Потрібна консультація агронома Bactogran для уточнення системи живлення.',
        soilActive: 'Біокомплекс Soil Active додатково мобілізує 10 кг/га доступного фосфору та попереджає його блокування на кислих і лужних ґрунтах. Це сприяє розвитку кореневої системи, ефективнішому використанню елементів живлення та стабільному формуванню запланованого врожаю.'
      }
    };

  } catch (error) {
    console.error('Помилка розрахунку у Web App:', error);
    throw new Error(error.message || 'Не вдалося виконати розрахунок. Перевірте вхідні дані.');
  }

  function getAppData(sessionToken) {
  // Перевірка безпеки сесії (якщо використовується)
  if (typeof validateSession_ === 'function') {
    validateSession_(sessionToken);
  }

  // Повертаємо об'єкт з даними, які очікує фронтенд
  return {
    // Список культур
    crops: ['Пшениця', 'Ріпак', 'Кукурудза', 'Соняшник', 'Соя'], 
    
    // Варіанти забезпеченості ґрунту (відповідно до скриншота 4)
    soilOptions: ['Низька', 'Середня', 'Висока'], 
    
    // Варіанти pH ґрунту (відповідно до скриншота 5)
    phOptions: ['5.0', '6.0', '7.0', '8.0'],
    
    // Зв'язок культури та доступних варіантів урожайності (відповідно до скриншота 3)
    yieldMap: {
      'Пшениця': [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10],
      'Ріпак': [2, 2.5, 3, 3.5, 4, 4.5, 5], // Приклад для інших культур
      'Кукурудза': [6, 7, 8, 9, 10, 11, 12, 13, 14],
      'Соняшник': [2, 2.5, 3, 3.5, 4],
      'Соя': [2, 2.5, 3, 3.5, 4]
    },
    
    privacyText: 'Калькулятор не збирає персональних даних',
    disclaimer: '* Рекомендована норма розрахована на основі середніх показників. Для точного розрахунку потрібен аналіз ґрунту.'
  };
}
}

