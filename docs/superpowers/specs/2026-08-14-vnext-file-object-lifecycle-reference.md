# vNext File Object and Storage Receipt Reference Contract

The vNext question-file/storage foundation keeps object identity separate from physical locations. A file object carries only an opaque object ID, version, expected SHA-256, byte count, media type and a closed storage class. Storage and backup location fields are deliberately opaque handles rather than filesystem paths, NAS shares, cloud bucket keys, drive letters, host names or credentials.

An object reaches `verified` only with both a write receipt and a separately identified read-verification receipt. A backup is likewise a separately identified copy plus verification operation, bound to a verified primary receipt. This allows one question file to have independent NAS and removable-disk backup evidence without treating either storage medium as an authorization authority.

The reference contract is deliberately evidence-shaped, not an I/O implementation. It cannot prove a NAS disk has spun up, a removable disk is attached, Docker permissions are correct, a cloud object still exists, or that a physical copy can be restored. Production task processors must later create these receipts only after trusted I/O and must retain immutable task/audit history when a current object is retried or quarantined.
