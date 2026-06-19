-- МАВИТА-ШОП — наполнение каталога (серия «Горы», 2025)
-- Применяется после schema.sql:  psql -U postgres -d mavita -f sql/seed.sql
-- Идемпотентно: upsert по slug, фото пересоздаются для seed-товаров.
--
-- Цены — в КОПЕЙКАХ (I2). Изображения берутся из /public/images/ (статика КП).

INSERT INTO products (slug, name, series, subtitle, description, price_kopecks, scent, in_stock, sort_order)
VALUES
  (
    'kvadratnaya-neizvedannye-tropy',
    'Аромасвеча контейнерная квадратная',
    'Горы · «Неизведанные тропы свободы»',
    'Неизведанные тропы свободы',
    'Квадратный контейнер из матового стекла с бетонной фактурой. Аромат хвои и холодного горного воздуха — лес после дождя, сосны на высоте. Свеча-медитация: зажгите, считайте QR и окажитесь в горах.',
    180000,
    ARRAY['Пихта','Кипарис','Можжевельник','Мох'],
    true, 10
  ),
  (
    'kruglaya-neizvedannye-tropy',
    'Аромасвеча контейнерная круглая',
    'Горы · «Неизведанные тропы свободы»',
    'Неизведанные тропы свободы',
    'Круглый контейнер — мягкая форма, скрывающая горную твёрдость. Аромат леса на высоте: хвоя, влажный камень, утренний туман. Горит ровно и долго — до 40 часов спокойствия.',
    200000,
    ARRAY['Эвкалипт','Пихта','Пачули','Можжевельник'],
    true, 20
  ),
  (
    'lava-moguchiy-pokoy',
    'Аромасвеча «Могущественный покой застывшей лавы»',
    'Горы · «Могущественный покой застывшей лавы»',
    'Могущественный покой застывшей лавы',
    'Контейнерная свеча в тёмном стекле. Аромат древесины и лавового камня — тёплый, тяжёлый, глубокий. Как горная порода: надёжная, неспешная, вечная. Дарит ощущение опоры.',
    180000,
    ARRAY['Сандал','Имбирь','Пачули','Кипарис'],
    true, 30
  ),
  (
    'galka-moguchiy-pokoy',
    'Формовая свеча «Галька»',
    'Горы · «Могущественный покой застывшей лавы»',
    'Могущественный покой застывшей лавы',
    'Формовая свеча в виде морских камней-галек. Отлита вручную из натурального воска, ароматизирована маслами. Ставится отдельно или в группе — как пирамида камней у горной тропы.',
    90000,
    ARRAY['Имбирь','Апельсин','Пачули','Земля'],
    true, 40
  )
ON CONFLICT (slug) DO UPDATE SET
  name          = EXCLUDED.name,
  series        = EXCLUDED.series,
  subtitle      = EXCLUDED.subtitle,
  description   = EXCLUDED.description,
  price_kopecks = EXCLUDED.price_kopecks,
  scent         = EXCLUDED.scent,
  in_stock      = EXCLUDED.in_stock,
  sort_order    = EXCLUDED.sort_order,
  updated_at    = now();

-- Обложки. Пересоздаём, чтобы seed оставался идемпотентным.
DELETE FROM product_images
WHERE product_id IN (
  SELECT id FROM products WHERE slug IN (
    'kvadratnaya-neizvedannye-tropy',
    'kruglaya-neizvedannye-tropy',
    'lava-moguchiy-pokoy',
    'galka-moguchiy-pokoy'
  )
);

INSERT INTO product_images (product_id, filename, sort_order, is_cover)
SELECT p.id, v.filename, 0, true
FROM (VALUES
  ('kvadratnaya-neizvedannye-tropy', '/images/2.jpeg'),
  ('kruglaya-neizvedannye-tropy',    '/images/3.jpeg'),
  ('lava-moguchiy-pokoy',            '/images/4.jpeg'),
  ('galka-moguchiy-pokoy',           '/images/8.jpeg')
) AS v(slug, filename)
JOIN products p ON p.slug = v.slug;
