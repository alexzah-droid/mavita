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
   'Стильная ароматная пирамида из двух контейнерных свечей и универсальной крышки. Свежий лесной воздух, дух приключений и 100% натуральный соевый воск.', 160000,
   ARRAY['Свежая трава','Бергамот','Эвкалипт','Пихта','Можжевельник','Тепло кожи','Пачули'], true, 'public', 10),
  ('simfoniya-kamney-1-cilindr', 'Симфония камней №1 (цилиндр)', 'Горы · Аромасвеча', 'Ты — первооткрыватель!',
   'Прекрасная и суровая, как северная природа, свеча с текстурой камня. QR-ритуал с аудиодорожкой дополняет погружение в природную стихию.', 200000,
   ARRAY['Свежая трава','Бергамот','Эвкалипт','Пихта','Можжевельник','Тепло кожи','Пачули'], true, 'public', 20),
  ('simfoniya-kamney-2-kub', 'Симфония камней №2 (куб)', 'Горы · Аромасвеча', 'Тайна застывшей лавы',
   'Ароматическая свеча из соевого воска в гипсовом стакане с фактурой остывшей лавы. Перец, ром, сандаловое дерево и пачули создают глубокую композицию.', 180000,
   ARRAY['Перец','Конопля','Ром','Сандаловое дерево','Пачули'], true, 'public', 30),
  ('simfoniya-kamney-3-cilindr', 'Симфония камней №3 (цилиндр)', 'Горы · Аромасвеча', 'Тайна застывшей лавы',
   'Стройная свеча, словно базальтовый столб. Разогретый перец, конопля и ром раскрываются на дымном сандаловом дереве и пачули.', 200000,
   ARRAY['Перец','Конопля','Ром','Сандаловое дерево','Пачули'], true, 'public', 40),
  ('morskoy-kamen', 'Морской камень', 'Горы · Свеча', 'Море и камень',
   'Свеча в форме обточенного морем камня: тёплый свет, морской бриз и спокойствие личной гавани.', 90000,
   ARRAY['Морская соль','Перец','Альдегиды','Смола лабданума','Зелёная трава','Фрезия','Кедр','Пачули'], true, 'public', 50),
  ('gornaya-vershina', 'Горная вершина', 'Горы · Свеча', 'Ты — первооткрыватель!',
   'Рельефная свеча, повторяющая очертания заснеженного пика. Символ роста, силы и неизбежных достижений.', 80000,
   ARRAY['Свежая трава','Бергамот','Эвкалипт','Пихта','Можжевельник','Тепло кожи','Пачули'], true, 'public', 60)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, series = EXCLUDED.series, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, price_kopecks = EXCLUDED.price_kopecks,
  scent = EXCLUDED.scent, in_stock = EXCLUDED.in_stock, visibility = EXCLUDED.visibility,
  sort_order = EXCLUDED.sort_order, updated_at = now();

DELETE FROM product_images WHERE product_id IN (
  SELECT id FROM products WHERE slug IN (
    'kamennaya-piramida', 'simfoniya-kamney-1-cilindr', 'simfoniya-kamney-2-kub',
    'simfoniya-kamney-3-cilindr', 'morskoy-kamen', 'gornaya-vershina'
  )
);

INSERT INTO product_images (product_id, filename, sort_order, is_cover)
SELECT p.id, v.filename, v.sort_order, v.is_cover
FROM (VALUES
  ('kamennaya-piramida','/images/catalog/001/001-01.png',10,true), ('kamennaya-piramida','/images/catalog/001/001-02.jpg',20,false), ('kamennaya-piramida','/images/catalog/001/001-03.jpg',30,false), ('kamennaya-piramida','/images/catalog/001/001-04.jpg',40,false), ('kamennaya-piramida','/images/catalog/001/001-05.jpg',50,false),
  ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-01.jpg',10,true), ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-02.jpg',20,false), ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-03.jpg',30,false), ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-04.jpg',40,false), ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-05.png',50,false), ('simfoniya-kamney-1-cilindr','/images/catalog/002/002-06.jpg',60,false),
  ('simfoniya-kamney-2-kub','/images/catalog/003/003-01.png',10,true), ('simfoniya-kamney-2-kub','/images/catalog/003/003-02.jpg',20,false), ('simfoniya-kamney-2-kub','/images/catalog/003/003-03.png',30,false), ('simfoniya-kamney-2-kub','/images/catalog/003/003-04.jpg',40,false), ('simfoniya-kamney-2-kub','/images/catalog/003/003-05.png',50,false),
  ('simfoniya-kamney-3-cilindr','/images/catalog/004/004-01.png',10,true), ('simfoniya-kamney-3-cilindr','/images/catalog/004/004-02.jpg',20,false), ('simfoniya-kamney-3-cilindr','/images/catalog/004/004-03.jpg',30,false), ('simfoniya-kamney-3-cilindr','/images/catalog/004/004-04.jpg',40,false), ('simfoniya-kamney-3-cilindr','/images/catalog/004/004-05.jpg',50,false),
  ('morskoy-kamen','/images/catalog/005/005-01.png',10,true), ('morskoy-kamen','/images/catalog/005/005-02.jpg',20,false), ('morskoy-kamen','/images/catalog/005/005-03.png',30,false), ('morskoy-kamen','/images/catalog/005/005-04.png',40,false), ('morskoy-kamen','/images/catalog/005/005-05.jpg',50,false),
  ('gornaya-vershina','/images/catalog/006/006-01.jpg',10,true), ('gornaya-vershina','/images/catalog/006/006-02.png',20,false), ('gornaya-vershina','/images/catalog/006/006-03.jpg',30,false), ('gornaya-vershina','/images/catalog/006/006-04.png',40,false), ('gornaya-vershina','/images/catalog/006/006-05.jpg',50,false)
) AS v(slug, filename, sort_order, is_cover)
JOIN products p ON p.slug = v.slug;
