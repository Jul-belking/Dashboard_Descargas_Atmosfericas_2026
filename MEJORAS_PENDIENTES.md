# Mejoras pendientes

Ideas y hallazgos detectados durante el desarrollo que **no** se implementaron
todavía. Cada punto incluye los datos reales que lo respaldan, medidos sobre el
dataset del proyecto, para no tener que volver a investigarlos.

Última actualización: 2026-08-25

---

## 1. Aprovechar el error de localización de cada descarga

**Estado:** sin implementar · **Impacto:** alto · **Esfuerzo:** medio

El parquet trae una columna `Error_km` con la incertidumbre de posición de cada
rayo, y hoy **no se usa para nada**. Los valores medidos sobre las 779.109
descargas:

| Métrica | Valor |
|---|---|
| Mediana | 392 m |
| Media | 534 m |
| Percentil 90 | 1.102 m |
| Máximo | 5.000 m |

**Por qué importa:** el radio de búsqueda por defecto es de 500 m y el error
mediano de posición es de 392 m. Son del mismo orden de magnitud. Un rayo
reportado a 400 m de un poste podría estar realmente a 900 m, o justo encima.
Decir "cayeron 79 rayos dentro de 500 m" suena exacto, pero arrastra una
incertidumbre que hoy el tablero no comunica.

Esto **no invalida el análisis**: sobre miles de descargas las desviaciones se
compensan estadísticamente. Lo que hace es marcar cuánta precisión es honesto
mostrar y qué tan lejos se puede llevar la interpretación caso por caso.

**Qué se puede hacer:**

- Mostrar cuántos de los rayos contados son de localización confiable
  (por ejemplo, `Error_km` por debajo de un umbral).
- Permitir excluir del análisis las descargas con error alto.
- Sumar el error al radio efectivo de cada rayo, en vez de tratar la
  posición como un punto exacto.
- Mostrar un intervalo en lugar de un número único: "entre 60 y 95 rayos".

Con esto el conteo pasaría de ser un número seco a una medida con nivel de
confianza asociado.

---

## 2. Usar la polaridad y el tipo de descarga

**Estado:** sin implementar · **Impacto:** alto · **Esfuerzo:** bajo

El parquet ya trae dos columnas que el tablero ignora por completo:

**`Polaridad_Descargas`**

| Polaridad | Cantidad |
|---|---|
| Negativo | 481.572 |
| Positivo | 297.537 |

**`Tipo`**

| Tipo | Cantidad |
|---|---|
| 1 | 763.294 |
| 2 | 11.672 |
| 3 | 4.143 |

**Por qué importa:** los rayos de polaridad positiva son bastante menos
frecuentes que los negativos, pero transportan mucha más energía y duración de
corriente. Son los que suelen provocar daño real en la infraestructura
eléctrica. Poder separar esas 297.537 descargas del resto cambiaría la lectura
de riesgo por completo.

Hoy el tablero trata a los 779.109 rayos como si todos fueran equivalentes.

**Qué se puede hacer:**

- Filtro por polaridad, o al menos una tarjeta que separe positivos de negativos.
- Diferenciar los rayos positivos en el mapa (color o forma distinta).
- Ponderar el riesgo por estructura según la polaridad, no solo por el conteo.
- Averiguar qué significan los valores 1, 2 y 3 de `Tipo` — probablemente
  distinguen rayo nube-tierra de descargas intra-nube, lo que cambiaría qué
  descargas deberían contarse como amenaza real.

**Requiere confirmar con Felipe o con el proveedor de los datos** el significado
exacto de la columna `Tipo` antes de usarla.

---

## 3. Rendimiento: lectura diferida del parquet

**Estado:** sin implementar · **Impacto:** medio-alto · **Esfuerzo:** bajo

Cada petición a `/api/procesar` lee el parquet completo — las 779.109 filas —
aunque después se filtre un solo día y 31 estructuras. Tiempos medidos:

| Escenario | Tiempo |
|---|---|
| Un solo día | 0,4 s |
| Rango típico (2025-2026) | 1,1 s |
| Histórico completo | 1,6 s |

**Por qué importa ahora más que antes:** desde que los filtros de ubicación se
aplican automáticamente al cambiarlos, se le pega a ese endpoint mucho más
seguido. Cada selección en un desplegable dispara una lectura completa.

**Qué se puede hacer:** cambiar `pl.read_parquet` por `pl.scan_parquet` (lectura
diferida). Eso empuja el filtro de fechas al motor de lectura, de modo que solo
suben a memoria las filas del rango pedido en lugar de las 779.109. Está en
[`backend/main.py`](backend/main.py), en el bloque de lectura de descargas.

También se puede cachear el dataframe en memoria, como ya se hace con
`_cache_rango_fechas`.

---

## 4. Bug en la limpieza de longitudes

**Estado:** sin corregir · **Impacto:** bajo hoy, alto a futuro · **Esfuerzo:** bajo

En [`backend/main.py`](backend/main.py), la función `clean_lon` reconstruye las
coordenadas asumiendo que **toda** longitud empieza en `-72`:

```python
elif digits.startswith("7") and len(digits) > 1:
    return float(f"-72.{digits[1:]}")
```

Una estructura en longitud `-73.123456` produce los dígitos `73123456`, que no
empiezan con `72`, así que cae en esa rama y se convierte en **`-72.3123456`**:
la estructura aparece unos 90 km al este de donde realmente está. Sin error, sin
advertencia, sin nada.

**Por qué no rompe hoy:** toda la operación de Geopark está en longitud -72
(las estructuras van de -72,77 a -72,61). El día que se sume un campo en otra
franja, el tablero va a mentir en silencio, y es el tipo de error que después
cuesta muchísimo encontrar.

**Nota adicional:** desde que el inventario pasó de CSV a XLSX, las coordenadas
llegan como número (`4432631.0`) en lugar de texto (`"4.432.631"`). La función
sigue funcionando, pero **por casualidad**: el `.0` del float agrega un cero
final que no altera el decimal. Es una coincidencia afortunada, no un diseño.
Se verificó que produce coordenadas idénticas a las del CSV anterior en las 726
estructuras válidas.

---

## 5. Corriente máxima con polaridad negativa

**Estado:** aparcado a pedido · **Impacto:** medio · **Esfuerzo:** muy bajo

En [`backend/main.py`](backend/main.py), alrededor de la línea del cálculo de
`corriente_max`:

```python
corriente_max = max(corrientes) if corrientes else 0
```

Las corrientes de rayo tienen signo, y la mayoría de las descargas son
negativas (481.572 de 779.109). Si un poste recibió rayos de `-30 kA` y `-5 kA`,
`max()` devuelve `-5`: **el más débil de los dos**.

El KPI que dice "corriente máxima" está mostrando el rayo menos peligroso.
Debería ser el máximo por valor absoluto.

Esto también se observó en la tabla de impactos antes de eliminarla, donde
varias estructuras mostraban `-6` como corriente máxima.

---

## 6. Exportar resultados

**Estado:** sin implementar · **Impacto:** alto para el usuario final · **Esfuerzo:** bajo

No hay forma de sacar los resultados del tablero. El backend ya calcula el
detalle por estructura (`resumen_impactos`: TAG, circuito, número de impactos y
corriente máxima) y lo envía al frontend, donde hoy solo alimenta el KPI de
estructuras afectadas.

Un botón que descargue eso como CSV o Excel es probablemente lo que más rápido
agradecería la gente de Geopark, y es de las cosas que hacen que un tablero se
use de verdad en lugar de mirarse una vez.

---

## 7. Auto-reload en Docker para desarrollo

**Estado:** sin implementar · **Impacto:** solo desarrollo · **Esfuerzo:** trivial

El contenedor corre `uvicorn` sin `--reload`, así que cada cambio en
`backend/main.py` obliga a un `docker compose restart web`. Los cambios en
`static/` sí se ven con recargar el navegador, porque el volumen `.:/app` monta
la carpeta viva dentro del contenedor.

Agregar `--reload` al comando del `docker-compose.yml` ahorra bastante tiempo
por sesión de trabajo.

---

## 8. Tasa de exposición acotada a la zona de operación

**Estado:** decisión tomada, alternativa documentada · **Impacto:** interpretativo

La tarjeta "Rayos en el Rango" cuenta **toda el área del parquet**, que es
mucho más grande que la zona donde están las estructuras:

| Fuente | Extensión | Área |
|---|---|---|
| Descargas (parquet) | 104 × 114 km | 11.907 km² |
| Estructuras (inventario) | 11 × 18 km | 190 km² |

El parquet cubre **63 veces** el área de la infraestructura.

Consecuencia sobre la tasa de exposición, con junio 2026 y radio de 1 km:

| Denominador | Total | En radio | Tasa |
|---|---|---|---|
| Todo el parquet (actual) | 3.722 | 79 | 2,12 % |
| Zona de operación (+2 km) | 297 | 79 | 26,6 % |

**Ambos números son correctos, pero responden preguntas distintas.** El actual
dice "de toda la actividad eléctrica de la región, cuánta tocó la red". El
acotado diría "de los rayos que cayeron en nuestra zona, cuántos amenazaron una
estructura" — que es lo que se leería naturalmente como riesgo.

Se optó por el denominador completo. Si alguna vez se quiere que el porcentaje
se lea como medida de riesgo, hay que acotar el denominador.

---

## 9. Calidad de datos

**Estado:** para revisar con Felipe / Geopark

**Circuito huérfano.** El circuito `Derivación Buco`, con 9 estructuras, existe
en `Inventario_Estructuras_y_DPS_Final.xlsx` pero no aparece en
`Localizaciones_Final.xlsx`. Esas 9 estructuras se ven con el filtro en "TODOS"
pero desaparecen apenas se filtre por cualquier nivel. La cobertura del cruce es
de 722 de 731 estructuras (98,8 %). Si deberían pertenecer a algún campo, falta
una fila en el maestro.

**Tag duplicado.** `TIG-TISE05 Y TSE-TIE35` aparece dos veces en el inventario,
con coordenadas distintas: son dos estructuras físicas compartiendo
identificador. Hoy no rompe nada porque el cruce se hace por circuito, pero
cualquier lógica futura que identifique una estructura por su tag va a fallar
con ese caso.

**Dataset divergente entre las dos copias del proyecto.** El `.parquet` de este
repositorio (7.461.904 bytes) es más reciente que el del repositorio de Felipe
(7.436.681 bytes). Antes de comparar resultados entre las dos versiones hay que
alinear ambos al mismo archivo, o las diferencias de métricas van a mezclar
diferencias de código con diferencias de datos.

---

## 10. Cruzar con el registro de fallas reales

**Estado:** idea · **Impacto:** el más alto de la lista · **Esfuerzo:** alto (depende de datos externos)

Hoy el tablero mide **exposición**: qué fracción de las descargas cayó cerca de
una estructura. No mide **daño**: cuántas de esas descargas efectivamente
provocaron una falla, un disparo de protección o un apagón.

Si Geopark tiene un registro de eventos de falla del sistema eléctrico con
fecha y hora, cruzarlo con las descargas convertiría el tablero en algo
cualitativamente distinto:

- Se podría calcular una **tasa de incidencia** real, no solo de exposición.
- Se podría validar empíricamente si el radio de 500 m es el correcto, en vez
  de que sea un criterio adoptado: buscando a qué distancia las descargas
  dejan de correlacionar con fallas.
- Se podría medir si las estructuras con DPS o DSD fallan menos que las que no
  tienen protección, que es la pregunta de negocio que justifica invertir en
  esos equipos.
- Habilitaría un modelo predictivo real, que hoy no existe: el cálculo actual
  es puramente descriptivo (un conteo espacial), no predictivo.

---

## 11. Limpieza menor

- `docker-compose.yml` conserva la línea `version: '3.8'`, obsoleta en las
  versiones actuales de Docker. Genera un warning en cada comando y se puede
  borrar sin efecto.
- `Localizaciones.xlsx` (el maestro viejo) sigue versionado aunque el código ya
  no lo usa: las fuentes activas son `Localizaciones_Final.xlsx` e
  `Inventario_Estructuras_y_DPS_Final.xlsx`.
- `static/script.js` conserva referencias a `fileDescargas` y `filePostes`, que
  son restos de cuando los archivos se subían por formulario. Hoy siempre son
  `null`.
