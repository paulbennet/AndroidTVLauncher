# Third-party notices

## QR Code generator library (Project Nayuki), MIT License
`app/src/main/assets/web/core/qr.js` is a reduced encoder that follows the structure of Project Nayuki's
QR Code generator library (https://www.nayuki.io/page/qr-code-generator-library).

Copyright (c) Project Nayuki. (MIT License)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to the following conditions:
- The above copyright notice and this permission notice shall be included in all copies or substantial portions of
  the Software.
- The Software is provided "as is", without warranty of any kind, express or implied, including but not limited to
  the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the
  authors or copyright holders be liable for any claim, damages or other liability, whether in an action of
  contract, tort or otherwise, arising from, out of or in connection with the Software or the use or other dealings
  in the Software.

## Gradle wrapper, Apache License 2.0
`gradlew`, `gradlew.bat` and `gradle/wrapper/` come from Gradle (https://gradle.org), Apache License 2.0.

## Build and test dependencies (not shipped in the APK)
AndroidX (Apache 2.0), Kotlin (Apache 2.0), playwright-core (Apache 2.0), TypeScript (Apache 2.0), jsQR (Apache 2.0).

## Gallery skins (`gallery/skins/`)
These parts are inside the skin packages, not in the APK.

### three.js, MIT License
Constellation, Tidepool and Paper Cut bundle a tree-shaken build of three.js (https://threejs.org) as
`vendor/three.module.js` (`npm run build:three`). Copyright © 2010-2024 three.js authors. MIT License: the same terms
as the QR Code generator library above.

### Fonts, SIL Open Font License 1.1
The fonts in each skin's `fonts/` folder come from Fontsource (https://fontsource.org) and are licensed under the SIL
Open Font License, Version 1.1 (https://openfontlicense.org):
- Sora: Copyright 2019 The Sora Project Authors (https://github.com/sora-xor/sora-font). Constellation.
- JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono). Phosphor, Code Rain.
- Jost: Copyright 2020 The Jost Project Authors (https://github.com/indestructible-type/Jost). Bauhaus, Live Aquarium.
- Fredoka: Copyright 2016 The Fredoka Project Authors (https://github.com/hafontia/Fredoka-One). Playroom.
- Manrope: Copyright 2019 The Manrope Project Authors (https://github.com/sharanda/manrope). Tidepool.
- Fraunces: Copyright 2020 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces). Paper Cut.
- Cormorant Garamond: Copyright 2015 The Cormorant Project Authors (https://github.com/CatharsisFonts/Cormorant). Holiday.

### Pictures
The pictures in the skins' `img/` folders (the Tidepool sea floor, the Live Aquarium tank and fish, the Holiday room)
were generated for this project with an AI image tool and are part of this project under its MIT License. The app
banners in the screenshots are placeholders from the desktop preview.
