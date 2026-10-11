"""Distinguish replays within the same launched game, independently of overlay."""
class CaptureSession:
    def __init__(self):
        self.identity=None;self.minute=None;self.generation=0

    def observe(self,score):
        identity=(score.get('score_ptr'),score['home'],score['away'])
        minute=score['minute']
        reset=(identity!=self.identity or self.minute is not None and minute+5<self.minute)
        if reset:self.generation+=1
        self.identity=identity;self.minute=minute
        return reset

    @property
    def token(self):return (self.identity,self.generation)
