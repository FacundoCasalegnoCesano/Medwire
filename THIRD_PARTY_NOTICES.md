# Third-party notices

## KokonutUI

The canonical component files in `src/components/kokonutui/` were added from the official KokonutUI shadcn registry. Their original effect implementations and copyright headers are retained; Mendwire adapts their props and surrounding layout in its consumers.

- [Halftone Background registry source](https://kokonutui.com/r/halftone-background.json) · [repository source](https://github.com/kokonut-labs/kokonutui/blob/main/components/kokonutui/halftone-background.tsx)
- [Type Writer registry source](https://kokonutui.com/r/type-writer.json) · [repository source](https://github.com/kokonut-labs/kokonutui/blob/main/components/kokonutui/type-writer.tsx)
- [Dynamic Text registry source](https://kokonutui.com/r/dynamic-text.json) · [repository source](https://github.com/kokonut-labs/kokonutui/blob/main/components/kokonutui/dynamic-text.tsx)
- [Marker Text registry source](https://kokonutui.com/r/marker-text.json) · [repository source](https://github.com/kokonut-labs/kokonutui/blob/main/components/kokonutui/marker-text.tsx)
- [Shared `cn` utility registry source](https://kokonutui.com/r/utils.json) · installed as `src/lib/utils.ts`

Pristine copies and SHA-256 hashes are recorded under `.cache/ui-redesign/upstream/kokonutui/`. Root independently checked all four official registry payloads; the four archived source hashes match exactly.

Copyright (c) 2025 kokonutUI. Source: [KokonutUI repository](https://github.com/kokonut-labs/kokonutui). Licensed under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Magic UI

`DitherField` was installed from the official Magic UI shadcn registry, retaining the registry source verbatim at `src/components/ui/dither-field.tsx`. The pristine registry payload and its extracted source are archived under `.cache/ui-redesign/upstream/magicui/`.

- [Dither Field documentation](https://magicui.design/docs/components/dither-field)
- [Dither Field registry payload](https://magicui.design/r/dither-field.json) · source path: `registry/magicui/dither-field.tsx`
- [Magic UI repository](https://github.com/magicuidesign/magicui)
- SHA-256 of archived registry payload: `7DD3200EB63CB61E1114E05CCF3E11D8B63B9708D52A8C441E7BD7DD4D039534`
- SHA-256 of installed and archived source: `E8D1BECB5B116E676EE1B5A8AAC91267848C0549EDE7926A5A161E3C0C319D12`

Copyright (c) Magic UI. Licensed under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## HeroUI v3

The application uses `@heroui/react` 3.2.6 and `@heroui/styles` 3.2.7 for accessible React controls and theme styles. Sources and licenses:

- [HeroUI React repository](https://github.com/heroui-inc/heroui/tree/v3/packages/react) · [MIT license](https://github.com/heroui-inc/heroui/blob/v3/LICENSE)
- [HeroUI Styles repository](https://github.com/heroui-inc/heroui/tree/v3/packages/styles) · [Apache License 2.0](https://github.com/heroui-inc/heroui/blob/v3/packages/styles/LICENSE)
- [Quick Start documentation](https://heroui.com/en/docs/react/getting-started/quick-start)

The packages are used under their published licenses. HeroUI React is distributed under MIT; HeroUI Styles is distributed under Apache-2.0. The applicable license texts are maintained by their upstream repositories.

## Iconiq UI Code Block

The Code Block component is installed from its original registry source. The unmodified JSON payload and extracted source are archived under `.cache/ui-redesign/upstream/iconiq/`; the installed file adds one explicit `tabIndex={0}` to its native copy button so Motion emits the same keyboard-focus attribute during server render and reduced-motion hydration.

- [Original registry payload](https://iconiqui.com/r/code-block.json)
- [21st.dev component entry](https://21st.dev/@edwinvakayil/components/code-block) · [MIT license](https://21st.dev/@edwinvakayil/components/code-block)
- SHA-256 of registry payload: `FC4579A99C44A32E163DA056E30A2B6D334E7110AA6DA052CE23E93FAC9A9422`
- SHA-256 of pristine archived source: `CD8C103853FE7438C2FE0741849C67F3800BF95A359396E7EE04E5F2BFF59DAD`
- SHA-256 of installed source with the hydration adaptation: `57ABB3013F80A21230FA288396AD883938B944AC1D6EDEDDE21C34C8169692FF`

The source declares `motion` and `lucide-react`, already present in the project. The application adapts its presentation through the shared theme and its consuming layout. Retain this attribution and MIT notice when distributing the source.

MIT License: Copyright (c) Edwin Vakayil. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to inclusion of this notice. The software is provided “as is”, without warranty of any kind.
