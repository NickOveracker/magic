| A 4-bit counter, from Magic's tutorial 11 (tut11a): reset it, then count.
| Run "irsim", then "@ counter.cmd" at the irsim> prompt.
| The cell's ground is labelled GND, and IRSIM's own is Gnd, so drive it low.
l GND
| The tutorial's clocks, vectors and watched nodes.
@ tut11a.cmd
| Reset: hold and RESET_B high, then RESET_B low for a cycle, then release both.
h RESET_B hold
c
l RESET_B
c
h RESET_B
c
l hold
ana clk RESET_B hold bits
| Count: each clock cycle adds one to bits (bit_3 ... bit_0).
c 8
d bits
