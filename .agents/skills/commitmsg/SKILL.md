---
name: commitmsg
description: Genera un mensaje de commit unificado siguiendo Conventional Commits
---

Revisa los cambios realizados (git diff/status) y genera un mensaje de commit unificado siguiendo estrictamente la convención de Conventional Commits.

Reglas:
- Header: <tipo>(<scope opcional>): <descripción concisa en imperativo> (feat, fix, refactor, chore, docs, test, etc.).
- Body (opcional, si abarca varios cambios): Lista de viñetas breves explicando el contexto o qué se ajustó.
- Salida estricta: Devuelve ÚNICAMENTE el texto final del commit listo para copiar o ejecutar, sin saludos ni explicaciones adicionales. Asegurate de que sea facil de copiar. 