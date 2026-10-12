import json,pathlib
d=pathlib.Path(__file__).parent
t=(d/'app.template.html').read_text()
eng=(d/'engine.js').read_text().replace('</script>','<\\/script>')
sample=(d.parent/'database/samples/meeting_01.txt').read_text().strip()
out=t.replace('/*ENGINE*/',eng).replace('/*SAMPLE*/',json.dumps(sample,ensure_ascii=False))
(d/'prompt-trap-lab.html').write_text(out)
print(len(out))
