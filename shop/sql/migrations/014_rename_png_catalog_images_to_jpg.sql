-- Переименовываем PNG-фотографии каталога в JPEG после оптимизации изображений.
-- Физические файлы уже конвертированы скриптом scripts/optimize-images.mjs.

UPDATE product_images
SET filename = regexp_replace(filename, '\.png$', '.jpg')
WHERE filename LIKE '/images/catalog/%.png';
