| OpenRAM's flip-flop: Q takes D at each rising edge of clk.
| Run "irsim tsmc35.20.n98t.3.3 dff" (the parameters for the TSMC 0.35 um
| process this technology targets), then "@ dff.cmd" at the irsim> prompt.
h vdd
l gnd
stepsize 5
clock clk 0 1
ana clk D Q
h D
c
d Q
l D
c
d Q
h D
c
d Q
