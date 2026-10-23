# Xiaoyun companion sprites

Created with the built-in ImageGen tool from a brief inspired by the user's appearance reference: an adult woman with long dark brown hair, a gentle face and a black dress. The final everyday outfit uses a modest midi dress and flats. These are six illustrated, semi-realistic character poses, not a rigged 3D model.

The original 3-by-2 PNG atlas is sliced by `scripts/prepare-pet-sprites.mjs`. The six 280-by-536 WebP images keep the generated transparency and use a common foot anchor. `PetPortraitMotion.ts` renders all six authored poses with short eased transitions, subpixel breathing and slight pointer-follow lean. Rest uses the closed-eye artwork; encouragement uses the raised-fist artwork. Facial pixels are not painted, stretched or reshaped. Patting/encouragement and confirmed chat completion trigger a small hop without squashing the portrait. The selected pose remains available as an image fallback without canvas. Reduced-motion preferences and hidden tabs are respected. This is pose-based 2D animation, not a skeleton rig. No external image service is used at runtime. The original generation prompt is saved in `generation-prompt.txt`.

Pose order: idle, wave, happy, thinking, cheer, sleep.
