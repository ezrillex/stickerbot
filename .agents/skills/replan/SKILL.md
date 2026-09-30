---
name: replan
description: Audita críticamente el plan anterior, verifica sus supuestos contra el repositorio y lo reescribe como un plan concreto para ejecución autónoma. Úsalo con /replan.
---

# Replan Workflow

Tu trabajo es revisar críticamente el plan anterior y convertirlo en un plan fiable y ejecutable por otro agente.

No asumas que el plan anterior es correcto solo porque parece coherente. Verifica sus decisiones importantes contra el repositorio antes de preservarlas.

El objetivo no es producir un plan más largo. El objetivo es producir un plan más correcto, concreto y difícil de malinterpretar.

## 1. Verifica antes de reescribir

Inspecciona el código necesario para comprobar:

- que los archivos, módulos, funciones, tipos y dependencias mencionados realmente existen;
- que el plan entiende correctamente el flujo actual;
- que no está proponiendo cambios incompatibles con la arquitectura existente;
- que no omite consumidores, relaciones o efectos secundarios relevantes;
- que los comandos de verificación realmente existen en el proyecto.

No inventes:

- rutas;
- nombres de funciones;
- APIs;
- scripts;
- tipos;
- configuración;
- comportamiento actual.

Si un detalle no puede verificarse, no lo conviertas en un hecho.

## 2. Ataca el plan

Busca activamente:

- pasos demasiado vagos para ejecutar sin reinterpretación;
- pasos demasiado grandes que mezclan varias responsabilidades;
- orden incorrecto de implementación;
- dependencias implícitas;
- supuestos no demostrados;
- edge cases obvios ignorados;
- contratos o interfaces que también deben actualizarse;
- migraciones o cambios de schema incompletos;
- validación, error handling o estados parciales olvidados;
- tests que deberían modificarse o añadirse;
- pasos redundantes;
- refactors o abstracciones innecesarias;
- cambios fuera del alcance real del objetivo.

No añadas complejidad preventiva para problemas hipotéticos sin evidencia.

## 3. Conserva lo que ya está bien

No reescribas decisiones correctas por preferencia personal.

Si el plan original ya resolvió correctamente una parte del problema, consérvala.

Prefiere cambios mínimos y consistentes con el código existente sobre rediseños amplios.

## 4. Convierte el resultado en instrucciones de ejecución

El Plan Final debe poder ser seguido por otro agente de forma autónoma.

Cada paso debe indicar, cuando sea relevante:

- **Dónde:** archivo, módulo o componente afectado.
- **Qué:** cambio concreto que debe realizarse.
- **Por qué:** comportamiento o invariante que debe conseguir.
- **Dependencias:** qué debe existir o haberse completado antes.
- **Verificación:** cómo comprobar que el paso quedó correctamente implementado.

Usa rutas exactas únicamente cuando las hayas verificado.

Si primero es necesario localizar algo durante la ejecución, dilo explícitamente en lugar de inventarlo.

## 5. Granularidad

Los pasos deben ser:

- secuenciales;
- suficientemente pequeños para ejecutarse y verificarse de forma independiente;
- suficientemente concretos para no requerir nuevas decisiones arquitectónicas importantes.

No conviertas el plan en pseudocódigo línea por línea.

No describas detalles triviales que el agente ejecutor pueda resolver directamente leyendo el código.

## 6. Verificación final

Incluye al final una fase de comprobación global apropiada para el repositorio:

- tests relevantes;
- typecheck;
- lint;
- build;
- migraciones;
- pruebas manuales concretas si son necesarias.

Usa únicamente comandos que hayas verificado que existen.

Si alguna verificación importante no puede ejecutarse o determinarse desde el repositorio, indícalo explícitamente.

# Formato de salida

## Changelog

Lista concisamente únicamente cambios materiales respecto al plan anterior:

- supuesto incorrecto → corrección;
- paso ambiguo → concretización;
- dependencia omitida → incorporación;
- sobreingeniería → simplificación;
- verificación faltante → añadida.

No menciones cambios meramente editoriales.

Si el plan original ya era correcto en una parte, no inventes una crítica para justificar cambios.

## Plan Final

Entrega el plan completo y corregido como una secuencia numerada de pasos.

Debe reemplazar al plan anterior por completo y quedar listo para que otro agente lo ejecute sin necesitar consultar el plan viejo.