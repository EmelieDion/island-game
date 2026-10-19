# Chaos Island

A floating island sandbox: control the weather, throw things at the village and watch the villagers rebuild it.

**Live:** https://emeliedion.github.io/island-game/

## Shadertoy shaders

- Sea: [Tileable Water Caustic](https://www.shadertoy.com/view/MdlXz8) by Dave_Hoskins
- Northern lights: [Auroras](https://www.shadertoy.com/view/XtGGRt) by nimitz

Ported to WGSL in `js/shaders/`. The sea is a low-poly mesh: every triangle samples the caustic shader once, so the water keeps the flat look of the island. The sky and the fire are custom WGSL shaders (not from Shadertoy).

## Controls

- Mouse movement changes the speed and brightness of the light on the water
- Drag to look around, scroll to zoom
- Click to use a tool: beach ball, barrel, rock, lightning or wind gust
- Weather machine: time, rain, snow, wind
- Time lever (`R`): rewind everything
- Snow at night shows the northern lights

## Tools

- Beach ball: bounces around, knocks villagers over but never breaks anything
- Barrel and rock: smash houses, trees and the boat, then float or sink
- Lightning: sets houses and trees on fire. Fire spreads with strong wind and goes out in the rain
- Wind gust: blows roofs off, pushes things away and fans the fire

## Villagers

- They walk around the village and run away when something lands or burns near them
- After a hit they pick up the loose blocks and carry them back until the house is rebuilt
- Blocks that end up in the sea come back as new blocks on the village square
- Trees, the windmill and the boat repair themselves, the time lever repairs everything at once

## Extras

- Rapier physics: everything breaks apart, floats and gets rebuilt
- TSL compute shaders for rain and snow
- Sound with the Web Audio API, including crackling fire
- The camera always stays above the island and the water

## My Blender models

- House: modelled and baked (`island-game-assets.jpg`)
- Windmill: modelled and animated, blade speed follows the wind slider

## Credits

- [Tree](https://poly.pizza/m/6Yjt8nIwLsD) by Marc Solà (CC BY 3.0)
- [Tree](https://poly.pizza/m/6pwiq7hSrHr) by Poly by Google (CC BY 3.0)
- [Sailboat](https://poly.pizza/m/1d76pfN4Dne) by Poly by Google (CC BY 3.0)
- [Worker](https://poly.pizza/m/Yg2bQZO6Hj) by Quaternius (CC0)
- [Farmer](https://poly.pizza/m/7pn3R6hPvE) by Quaternius (CC0)
