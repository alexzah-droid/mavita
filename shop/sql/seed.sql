-- МАВИТА-ШОП — витринный каталог «Горы».
-- Идемпотентно: заменяет первоначальные 4 demo-товара шестью актуальными.
-- Применять после schema.sql и migrations/002_admin_visibility_discount.sql.

DELETE FROM products WHERE slug IN (
  'kvadratnaya-neizvedannye-tropy', 'kruglaya-neizvedannye-tropy',
  'lava-moguchiy-pokoy', 'galka-moguchiy-pokoy'
);

INSERT INTO products (slug, name, series, subtitle, description, price_kopecks, scent, in_stock, visibility, sort_order)
VALUES
  ('kamennaya-piramida', 'Каменная пирамида', 'Горы · Аромасвеча', 'Ты — первооткрыватель!',
   E'Невероятно стильная и ароматная пирамида - тур из двух контейнерных свечей и универсальной крышки, которая подходит к обеим ёмкостям.\nНатуральный соевый воск раскроет аромат наилучшим образом - сначала вас захватят ноты свежей травы и бергамота, затем свеча раскроется эвкалиптом, пихтой и можжевельником, чтобы потом подарить вам невероятное тепло кожи и пачули.\nЦелое путешествие в одной свече станет настоящим приключением и отличным подарком. Свеча бережно упаковывается в брендированную подарочную коробку с надёжной защитой.', 160000,
   ARRAY['Свежая трава','Бергамот','Эвкалипт','Пихта','Можжевельник','Тепло кожи','Пачули'], true, 'public', 10),
  ('simfoniya-kamney-1-cilindr', 'Симфония камней №1 (цилиндр)', 'Горы · Аромасвеча', 'Ты — первооткрыватель!',
   E'Прекрасная и суровая как северная природа, эта свеча согреет вас своим огонём и окутает дивным ароматом.\nПродолжая серию "Горы", она наполнена уже знакомым ароматом "Ты - первооткрыватель!"\nНемного шершавая текстурная поверхность подарит ощущение прикосновения к настоящему камню, а если вы загрузите аудиодоржку по QR-коду с открытки, то погружение в природную стихию станет ПОЛНЫМ!', 200000,
   ARRAY['Свежая трава','Бергамот','Эвкалипт','Пихта','Можжевельник','Тепло кожи','Пачули'], true, 'public', 20),
  ('simfoniya-kamney-2-kub', 'Симфония камней №2 (куб)', 'Горы · Аромасвеча', 'Тайна застывшей лавы',
   'Погрузитесь в мистическую атмосферу с ароматической свечой "Тайна застывшей лавы", созданной из соевого воска в гипсовом стакане, имитирующем остывшую лаву. Смелая композиция из нот перца, конопли и рома в сочетании с дымными аккордами сандалового дерева и землистыми пачули создаёт уникальный аромат, который пленит и интригует. Камни обсидиана, украшающие свечу, добавляют особую силу и таинственность вашему пространству. Ощутите роскошь и загадочность с каждым зажжением этой свечи.', 180000,
   ARRAY['Перец','Конопля','Ром','Сандаловое дерево','Пачули'], true, 'public', 30),
  ('simfoniya-kamney-3-cilindr', 'Симфония камней №3 (цилиндр)', 'Горы · Аромасвеча', 'Тайна застывшей лавы',
   'Стройный цилиндр, словно базальтовый столб, рождённый застывшим лавовым потоком, — его строгая вертикаль приносит в дом спокойную силу горной породы. Внутри 100% натуральный соевый воск и тот же завораживающий аромат «Тайна застывшей лавы»: разогретый перец, дерзкая конопля и тёплый ром раскрываются на дымном сандаловом дереве и оседают землистыми пачули. Натуральные камни обсидиана у основания хранят энергию вулкана и притягивают взгляд. Зажгите свечу — и пламя медленно обнажит характер камня, наполняя пространство глубиной, теплом и благородной тайной.', 200000,
   ARRAY['Перец','Конопля','Ром','Сандаловое дерево','Пачули'], true, 'public', 40),
  ('morskoy-kamen', 'Морской камень', 'Горы · Свеча', 'Море и камень',
   'Морская Галька - откройте для себя уникальную свечу в форме морской гальки, которая перенесёт вас в мир спокойствия и гармонии. Вдохните свежесть океанского ветра, почувствуйте прикосновение камней, омытых морем, которые хранят в себе силу вечных приливов. Подарите себе или близким кусочек природы, который будет радовать ощущением свежести в каждом зажжённом огоньке. Ваша личная гавань спокойствия ждёт вас.', 90000,
   ARRAY['Морская соль','Перец','Альдегиды','Смола лабданума','Зелёная трава','Фрезия','Кедр','Пачули'], true, 'public', 50),
  ('gornaya-vershina', 'Горная вершина', 'Горы · Свеча', 'Ты — первооткрыватель!',
   'Удивительно реалистичная свеча «Горная вершина» — символ величия и мудрости, духовного роста и неизбежных достижений. Её рельеф повторяет очертания заснеженного пика, напоминая: каждая вершина покоряется тому, кто продолжает идти. Ароматизированная свеча передаёт ноты чистого горного воздуха и свежесть высокогорных трав, а в глубине звучит величие земли и камня. Зажгите её — и комната наполнится прохладой высоты и спокойной силой, которая возвращает ясность и опору. Достойный подарок себе или тому, кто идёт к своей цели.', 80000,
   ARRAY['Свежая трава','Бергамот','Эвкалипт','Пихта','Можжевельник','Тепло кожи','Пачули'], true, 'public', 60)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, series = EXCLUDED.series, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, price_kopecks = EXCLUDED.price_kopecks,
  scent = EXCLUDED.scent, in_stock = EXCLUDED.in_stock, visibility = EXCLUDED.visibility,
  sort_order = EXCLUDED.sort_order, updated_at = now();

UPDATE products AS p
SET weight_grams = v.weight_grams,
    box_length_cm = 12,
    box_width_cm = 12,
    box_height_cm = 12,
    wax_weight = v.wax_weight,
    burn_time_hours = v.burn_time_hours,
    wax = '100% соевый воск',
    wick = 'Хлопковый'
FROM (VALUES
  ('kamennaya-piramida', 500, 'верхняя часть — 25 г, нижняя часть — 85 г', 26),
  ('simfoniya-kamney-1-cilindr', 540, '120 г', 24),
  ('simfoniya-kamney-2-kub', 380, '90 г', 20),
  ('simfoniya-kamney-3-cilindr', 540, '120 г', 24),
  ('morskoy-kamen', 115, NULL, 15),
  ('gornaya-vershina', 90, NULL, 13)
) AS v(slug, weight_grams, wax_weight, burn_time_hours)
WHERE p.slug = v.slug;

DELETE FROM product_images WHERE product_id IN (
  SELECT id FROM products WHERE slug IN (
    'kamennaya-piramida', 'simfoniya-kamney-1-cilindr', 'simfoniya-kamney-2-kub',
    'simfoniya-kamney-3-cilindr', 'morskoy-kamen', 'gornaya-vershina'
  )
);

INSERT INTO product_images (product_id, filename, sort_order, is_cover)
SELECT p.id, v.filename, v.sort_order, v.is_cover
FROM (VALUES
  ('kamennaya-piramida','/images/catalog/001/001-01.jpg',10,true), ('kamennaya-piramida','/images/catalog/001/001-02.jpg',20,false), ('kamennaya-piramida','/images/catalog/001/001-03.jpg',30,false), ('kamennaya-piramida','/images/catalog/001/001-04.jpg',40,false), ('kamennaya-piramida','/images/catalog/001/001-05.jpg',50,false),
  ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-01.jpg',10,true), ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-02.jpg',20,false), ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-03.jpg',30,false), ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-04.jpg',40,false), ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-05.jpg',50,false), ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-06.jpg',60,false),
  ('simfoniya-kamney-2-kub','/images/catalog/003/003-01.jpg',10,true), ('simfoniya-kamney-2-kub','/images/catalog/003/003-02.jpg',20,false), ('simfoniya-kamney-2-kub','/images/catalog/003/003-03.jpg',30,false), ('simfoniya-kamney-2-kub','/images/catalog/003/003-04.jpg',40,false), ('simfoniya-kamney-2-kub','/images/catalog/003/003-05.jpg',50,false),
  ('simfoniya-kamney-3-cilindr','/images/catalog/004/004-01.jpg',10,true), ('simfoniya-kamney-3-cilindr','/images/catalog/004/004-02.jpg',20,false), ('simfoniya-kamney-3-cilindr','/images/catalog/004/004-03.jpg',30,false), ('simfoniya-kamney-3-cilindr','/images/catalog/004/004-04.jpg',40,false), ('simfoniya-kamney-3-cilindr','/images/catalog/004/004-05.jpg',50,false),
  ('morskoy-kamen','/images/catalog/005/005-01.jpg',10,true), ('morskoy-kamen','/images/catalog/005/005-02.jpg',20,false), ('morskoy-kamen','/images/catalog/005/005-03.jpg',30,false), ('morskoy-kamen','/images/catalog/005/005-04.jpg',40,false), ('morskoy-kamen','/images/catalog/005/005-05.jpg',50,false),
  ('gornaya-vershina','/images/catalog/006/006-01.jpg',10,true), ('gornaya-vershina','/images/catalog/006/006-02.jpg',20,false), ('gornaya-vershina','/images/catalog/006/006-03.jpg',30,false), ('gornaya-vershina','/images/catalog/006/006-04.jpg',40,false), ('gornaya-vershina','/images/catalog/006/006-05.jpg',50,false)
) AS v(slug, filename, sort_order, is_cover)
JOIN products p ON p.slug = v.slug;
