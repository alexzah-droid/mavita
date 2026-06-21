// Заглушка пакета `server-only` для vitest (node-окружение без react-server-условия).
// В проде guard работает: Next подставляет настоящий `server-only`, и импорт в
// Client Component падает на сборке. В юнит-тестах guard инертен.
export {}
