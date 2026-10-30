# Cell annotation

People mark bacteria cells in microscope photos so the gap between each cell's dark center and outer ring can be measured. Results are compared with the lab's neural-network pipeline.

## Images and people

**Image**:
One microscope photo in the library, kept exactly as uploaded.
_Avoid_: photo, picture, file

**Library**:
The images a person can see: the ones they uploaded, plus images others have shared.
_Avoid_: gallery, dataset

**Owner**:
The person who uploaded an image. Only the owner can share or delete it.
_Avoid_: uploader, creator

**Shared image**:
An image its owner has made visible to everyone who is signed in.
_Avoid_: public image

**Annotator**:
The person who marks cells, identified on their annotations by the name they chose.
_Avoid_: user, labeller, student, doctor (these are roles, not the term)

## Annotating

**Annotation**:
One annotator's cells on one image, with its status and measurement settings. Each annotator has their own annotation of an image.
_Avoid_: labels, markup

**Status**:
How far an annotator is with an image: not started, in progress or done.
_Avoid_: state, progress

**Annotation session**:
An annotator's period of editing one annotation, including the cell being drawn, the selection and undo history.
_Avoid_: editor, document

**Cell**:
One bacterium in an image, marked by two outlines: its outer ring and its dark center.
_Avoid_: bacterium, object, detection

**Outer ring**:
The dark ring at the edge of a cell.
_Avoid_: outer edge, rim, outer polygon

**Dark center**:
The dark blob in the middle of a cell. Its edge is where the gap starts.
_Avoid_: inner ring, nucleus, inner polygon

**Draw mode**:
How a cell's outlines are drawn: points (clicked one by one) or freehand (traced, less precise). Each cell remembers its draw mode.
_Avoid_: tool, brush

## Measuring

**Measurement line**:
One of the evenly spaced lines from the dark center's centroid along which the gap is measured (32 by default).
_Avoid_: ray (in UI text), spoke

**Gap**:
The distance from the dark center's edge to the outer ring along one measurement line, and by extension a cell's median of those. Annotators see it as "distance".
_Avoid_: center-to-ring distance, width

**Unusual line**:
A measurement line whose gap is far from the others by the pipeline's 3×MAD rule, and is left out of the cell's gap statistics.
_Avoid_: outlier, rejected ray (in UI text)
