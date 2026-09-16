# TSP Light Panel - ESP32-S3 HUB75 Firmware

Firmware para los paneles físicos de comisarios de pista para el Autódromo Víctor Borrat Fabini (El Pinar).

## Características
- **Control Directo HUB75 por DMA**: Dibuja banderas a más de 60 FPS con brillo de hasta 6500 nits a pleno sol.
- **Sin PC ni HDMI**: Arranca en 0.2 segundos directamente a la memoria de video.
- **Protocolo UDP en Tiempo Real**: Escucha en el puerto `8888` los eventos emitidos por `tsp-server`.
- **Sincronización Automática**: El servidor emite un heartbeat cada 1 segundo con el estado de todos los paneles. Si el panel se enciende en medio de una carrera, se sincroniza en menos de 1 segundo.
- **Animaciones FIA**:
  - `YELLOW DOUBLE`: Chevrones a 45° en movimiento continuo.
  - `BLUE`: Balizas parpadeantes en las cuatro esquinas.
  - `RAIN`: Gotas de lluvia animadas con fondo húmedo.
  - `SAFETY CAR` / `VSC`: Letras con barra de destellos superior.
  - `CHEQUERED`: Damero blanco y negro.

## Requisitos de Hardware
1. Módulo LED Exterior P4 o P5 IP65 (64x64 o 64x32).
2. Placa ESP32-S3 (Waveshare ESP32-S3 Matrix Board o ESP32-S3 DevKit con Shield HUB75).
3. Fuente 5V 10A / 15A.

## Compilación y Flasheo
Con PlatformIO (VS Code o terminal):
```bash
pio run -t upload
```
O con Arduino IDE instalando las librerías:
- `ESP32 HUB75 LED MATRIX PANEL DMA Display` (por mrfaptastic)
- `Adafruit GFX Library`
- `ArduinoJson`
